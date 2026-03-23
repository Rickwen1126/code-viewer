import * as vscode from 'vscode'
import type { WsMessage } from '@code-viewer/shared'
import { createMessage } from '../ws/client'

// Get the Git extension API
function getGitApi() {
  const gitExtension = vscode.extensions.getExtension('vscode.git')
  if (!gitExtension?.isActive) return null
  const api = gitExtension.exports.getAPI(1)
  return api
}

// Get the repo matching the workspace root (not a worktree sub-repo)
export function getWorkspaceRepo() {
  const git = getGitApi()
  if (!git || git.repositories.length === 0) return null
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  if (!workspaceRoot) return git.repositories[0]
  // Find repo whose root matches workspace root
  const match = git.repositories.find((r: any) => r.rootUri.fsPath === workspaceRoot)
  return match ?? git.repositories[0]
}

export async function handleGitStatus(msg: WsMessage, sendResponse: (msg: WsMessage) => void): Promise<void> {
  const repo = getWorkspaceRepo()
  if (!repo) {
    sendResponse(createMessage('git.status.result', {
      branch: '', ahead: 0, behind: 0, changedFiles: [],
    }, msg.id))
    return
  }
  const branch = repo.state.HEAD?.name ?? ''
  const commitHash = repo.state.HEAD?.commit ?? ''
  const ahead = repo.state.HEAD?.ahead ?? 0
  const behind = repo.state.HEAD?.behind ?? 0

  const mapChange = (change: any) => ({
    path: vscode.workspace.asRelativePath(change.uri),
    status: mapGitStatus(change.status),
    oldPath: change.renameUri ? vscode.workspace.asRelativePath(change.renameUri) : undefined,
    insertions: 0,
    deletions: 0,
  })

  const stagedFiles = repo.state.indexChanges.map(mapChange)
  const unstagedFiles = repo.state.workingTreeChanges.map(mapChange)

  // Combined list for backward compatibility
  const allFiles = [...stagedFiles]
  for (const uf of unstagedFiles) {
    if (!allFiles.find((f: any) => f.path === uf.path)) {
      allFiles.push(uf)
    }
  }

  sendResponse(createMessage('git.status.result', {
    branch, commitHash, ahead, behind, changedFiles: allFiles, stagedFiles, unstagedFiles,
  }, msg.id))
}

function mapGitStatus(status: number): 'added' | 'modified' | 'deleted' | 'renamed' {
  // VS Code Git status enum: 0=Modified, 1=Added, 2=Deleted, 3=Renamed, 4=Copied, 5=Untracked, 6=Ignored, 7=Intent to Add
  switch (status) {
    case 1: case 5: case 7: return 'added'
    case 2: return 'deleted'
    case 3: return 'renamed'
    default: return 'modified'
  }
}

// git.log — get commit history
export async function handleGitLog(msg: WsMessage, sendResponse: (msg: WsMessage) => void): Promise<void> {
  const { maxCount = 30 } = (msg.payload ?? {}) as { maxCount?: number }
  const repo = getWorkspaceRepo()
  if (!repo) {
    sendResponse(createMessage('git.log.result', { commits: [] }, msg.id))
    return
  }
  try {
    const log = await repo.log({ maxEntries: maxCount })
    const commits = log.map((entry: any) => ({
      hash: entry.hash,
      hashShort: entry.hash.slice(0, 7),
      message: entry.message,
      author: entry.authorName ?? entry.authorEmail ?? 'unknown',
      date: entry.authorDate ? new Date(entry.authorDate).toISOString() : null,
      parents: entry.parents ?? [],
    }))
    sendResponse(createMessage('git.log.result', { commits }, msg.id))
  } catch {
    sendResponse(createMessage('git.log.result', { commits: [] }, msg.id))
  }
}

// git.commitFiles — get changed files for a specific commit
export async function handleGitCommitFiles(msg: WsMessage, sendResponse: (msg: WsMessage) => void): Promise<void> {
  const { hash } = msg.payload as { hash: string }
  const repo = getWorkspaceRepo()
  if (!repo) {
    sendResponse(createMessage('git.commitFiles.result', { files: [] }, msg.id))
    return
  }
  try {
    // Get diff between this commit and its parent
    const parentHash = hash + '~1'
    const changes = await repo.diffBetween(parentHash, hash)
    const files = changes.map((change: any) => ({
      path: vscode.workspace.asRelativePath(change.uri),
      status: mapGitStatus(change.status),
    }))
    sendResponse(createMessage('git.commitFiles.result', { hash, files }, msg.id))
  } catch {
    sendResponse(createMessage('git.commitFiles.result', { hash, files: [] }, msg.id))
  }
}

export async function handleGitDiff(msg: WsMessage, sendResponse: (msg: WsMessage) => void): Promise<void> {
  const { path, commit } = msg.payload as { path: string; commit?: string }
  const repo = getWorkspaceRepo()
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
  if (!repo || !workspaceFolder) {
    sendResponse(createMessage('git.diff.result', { path, hunks: [] }, msg.id))
    return
  }

  try {
    let diff: string
    if (commit) {
      // Diff for a specific commit: parent..commit
      const { execSync } = require('child_process') as typeof import('child_process')
      diff = execSync(`git diff ${commit}~1 ${commit} -- "${path}"`, {
        cwd: workspaceFolder.uri.fsPath,
        encoding: 'utf-8',
        maxBuffer: 5 * 1024 * 1024,
      })
    } else {
      // Diff working tree vs HEAD
      const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, path)
      diff = await repo.diffWithHEAD(fileUri.fsPath)
    }

    const hunks = parseUnifiedDiff(diff)
    sendResponse(createMessage('git.diff.result', { path, hunks }, msg.id))
  } catch {
    sendResponse(createMessage('git.diff.result', { path, hunks: [] }, msg.id))
  }
}

export function parseUnifiedDiff(diffText: string): Array<{
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  changes: Array<{
    type: 'add' | 'delete' | 'normal'
    content: string
    oldLineNumber?: number
    newLineNumber?: number
  }>
}> {
  if (!diffText) return []
  const lines = diffText.split('\n')
  const hunks: Array<{
    oldStart: number
    oldLines: number
    newStart: number
    newLines: number
    changes: Array<{
      type: 'add' | 'delete' | 'normal'
      content: string
      oldLineNumber?: number
      newLineNumber?: number
    }>
  }> = []
  let currentHunk: (typeof hunks)[number] | null = null
  let oldLine = 0
  let newLine = 0

  for (const line of lines) {
    const hunkHeader = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
    if (hunkHeader) {
      currentHunk = {
        oldStart: parseInt(hunkHeader[1]),
        oldLines: parseInt(hunkHeader[2] ?? '1'),
        newStart: parseInt(hunkHeader[3]),
        newLines: parseInt(hunkHeader[4] ?? '1'),
        changes: [],
      }
      oldLine = currentHunk.oldStart
      newLine = currentHunk.newStart
      hunks.push(currentHunk)
      continue
    }
    if (!currentHunk) continue

    if (line.startsWith('+')) {
      currentHunk.changes.push({ type: 'add', content: line.slice(1), newLineNumber: newLine })
      newLine++
    } else if (line.startsWith('-')) {
      currentHunk.changes.push({ type: 'delete', content: line.slice(1), oldLineNumber: oldLine })
      oldLine++
    } else if (line.startsWith(' ')) {
      currentHunk.changes.push({ type: 'normal', content: line.slice(1), oldLineNumber: oldLine, newLineNumber: newLine })
      oldLine++
      newLine++
    }
  }
  return hunks
}

// Watch for git status changes
export function startGitWatchers(sendEvent: (msg: WsMessage) => void): vscode.Disposable[] {
  const repo = getWorkspaceRepo()
  if (!repo) return []
  const disposable = repo.state.onDidChange(() => {
    const branch = repo.state.HEAD?.name ?? ''
    const changedFileCount = repo.state.workingTreeChanges.length + repo.state.indexChanges.length
    sendEvent(createMessage('git.statusChanged', { branch, changedFileCount }))
  })

  return [disposable]
}
