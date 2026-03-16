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

export async function handleGitStatus(msg: WsMessage, sendResponse: (msg: WsMessage) => void): Promise<void> {
  const git = getGitApi()
  if (!git || git.repositories.length === 0) {
    sendResponse(createMessage('git.status.result', {
      branch: '', ahead: 0, behind: 0, changedFiles: [],
    }, msg.id))
    return
  }

  const repo = git.repositories[0]
  const branch = repo.state.HEAD?.name ?? ''
  const ahead = repo.state.HEAD?.ahead ?? 0
  const behind = repo.state.HEAD?.behind ?? 0

  const changedFiles = repo.state.workingTreeChanges.map((change: any) => ({
    path: vscode.workspace.asRelativePath(change.uri),
    status: mapGitStatus(change.status),
    oldPath: change.renameUri ? vscode.workspace.asRelativePath(change.renameUri) : undefined,
    insertions: 0, // Not available from Git API directly
    deletions: 0,
  }))

  // Also include index (staged) changes
  const indexChanges = repo.state.indexChanges.map((change: any) => ({
    path: vscode.workspace.asRelativePath(change.uri),
    status: mapGitStatus(change.status),
    oldPath: change.renameUri ? vscode.workspace.asRelativePath(change.renameUri) : undefined,
    insertions: 0,
    deletions: 0,
  }))

  // Merge and deduplicate
  const allFiles = [...changedFiles]
  for (const ic of indexChanges) {
    if (!allFiles.find((f: any) => f.path === ic.path)) {
      allFiles.push(ic)
    }
  }

  sendResponse(createMessage('git.status.result', {
    branch, ahead, behind, changedFiles: allFiles,
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

export async function handleGitDiff(msg: WsMessage, sendResponse: (msg: WsMessage) => void): Promise<void> {
  const { path } = msg.payload as { path: string }
  const git = getGitApi()
  if (!git || git.repositories.length === 0) {
    sendResponse(createMessage('git.diff.result', { path, hunks: [] }, msg.id))
    return
  }

  const repo = git.repositories[0]
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
  if (!workspaceFolder) {
    sendResponse(createMessage('git.diff.result', { path, hunks: [] }, msg.id))
    return
  }

  try {
    const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, path)
    const diff = await repo.diffWithHEAD(fileUri.fsPath)

    // Parse unified diff format into hunks
    const hunks = parseUnifiedDiff(diff)
    sendResponse(createMessage('git.diff.result', { path, hunks }, msg.id))
  } catch {
    sendResponse(createMessage('git.diff.result', { path, hunks: [] }, msg.id))
  }
}

function parseUnifiedDiff(diffText: string): Array<{
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
  const git = getGitApi()
  if (!git || git.repositories.length === 0) return []

  const repo = git.repositories[0]
  const disposable = repo.state.onDidChange(() => {
    const branch = repo.state.HEAD?.name ?? ''
    const changedFileCount = repo.state.workingTreeChanges.length + repo.state.indexChanges.length
    sendEvent(createMessage('git.statusChanged', { branch, changedFileCount }))
  })

  return [disposable]
}
