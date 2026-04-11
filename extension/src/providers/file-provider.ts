import * as vscode from 'vscode'
import type { WsMessage } from '@code-viewer/shared'
import type { FileTreeNode } from '@code-viewer/shared'
import { createMessage } from '../ws/client'
import { debugLog } from '../utils/debug'
import { validatePath } from '../utils/validate-path'

// Handle file.tree request: recursively read workspace directory
export async function handleFileTree(
  msg: WsMessage,
  sendResponse: (msg: WsMessage) => void,
): Promise<void> {
  const payload = msg.payload as { path?: string }
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
  if (!workspaceFolder) {
    sendResponse(createMessage('file.tree.error', { code: 'NOT_FOUND', message: 'No workspace open' }, msg.id))
    return
  }

  const rootUri = workspaceFolder.uri
  const basePath = payload.path || ''

  // Validate path to prevent traversal attacks
  if (basePath) {
    const validation = validatePath(basePath, workspaceFolder)
    if (!validation.valid) {
      sendResponse(createMessage('file.tree.error', { code: 'INVALID_REQUEST', message: validation.reason }, msg.id))
      return
    }
  }

  try {
    const nodes = await readDirectoryRecursive(rootUri, basePath)
    sendResponse(createMessage('file.tree.result', {
      root: workspaceFolder.uri.fsPath,
      nodes,
    }, msg.id))
  } catch (err) {
    sendResponse(createMessage('file.tree.error', {
      code: 'NOT_FOUND',
      message: String(err),
    }, msg.id))
  }
}

async function readDirectoryRecursive(
  rootUri: vscode.Uri,
  relativePath: string,
  depth = 0,
  maxDepth = 10,
): Promise<FileTreeNode[]> {
  if (depth > maxDepth) return []

  const targetUri = relativePath
    ? vscode.Uri.joinPath(rootUri, relativePath)
    : rootUri

  const entries = await vscode.workspace.fs.readDirectory(targetUri)
  const nodes: FileTreeNode[] = []

  for (const [name, type] of entries) {
    const entryPath = relativePath ? `${relativePath}/${name}` : name
    const entryUri = vscode.Uri.joinPath(rootUri, entryPath)

    if (type === vscode.FileType.Directory) {
      // Skip node_modules, .git, dist, etc.
      if (shouldSkipDirectory(name)) continue

      const children = await readDirectoryRecursive(rootUri, entryPath, depth + 1, maxDepth)
      nodes.push({
        path: entryPath,
        name,
        type: 'directory',
        isGitIgnored: false, // simplified for MVP
        isDirty: false,
        children,
      })
    } else if (type === vscode.FileType.File) {
      // Get file stats for size
      let size: number | undefined
      try {
        const stat = await vscode.workspace.fs.stat(entryUri)
        size = stat.size
      } catch {
        // ignore stat errors
      }

      // Check if file is dirty (has unsaved changes)
      const doc = vscode.workspace.textDocuments.find(
        (d) => d.uri.fsPath === entryUri.fsPath,
      )

      // Get languageId from VS Code
      let languageId: string | undefined
      if (doc) {
        languageId = doc.languageId
      } else {
        // Infer from extension
        languageId = getLanguageIdFromPath(name)
      }

      nodes.push({
        path: entryPath,
        name,
        type: 'file',
        size,
        isGitIgnored: false, // simplified for MVP
        isDirty: doc?.isDirty ?? false,
        languageId,
      })
    }
  }

  // Sort: directories first, then alphabetical
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return nodes
}

const SKIPPED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  '.next',
  'dist',
  'build',
  '.cache',
  '.turbo',
  'coverage',
  '__pycache__',
  '.venv',
])

export function shouldSkipDirectory(name: string): boolean {
  return SKIPPED_DIRECTORIES.has(name)
}

function getLanguageIdFromPath(filename: string): string | undefined {
  const ext = filename.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescriptreact', js: 'javascript', jsx: 'javascriptreact',
    json: 'json', md: 'markdown', css: 'css', html: 'html', py: 'python',
    rs: 'rust', go: 'go', java: 'java', yaml: 'yaml', yml: 'yaml',
    toml: 'toml', sh: 'shellscript', bash: 'shellscript', sql: 'sql',
    graphql: 'graphql', vue: 'vue', svelte: 'svelte', scss: 'scss', less: 'less',
  }
  return ext ? map[ext] : undefined
}

export function escapeGlobPattern(path: string): string {
  return path.replace(/[\\*?{}[\]!]/g, '\\$&')
}

function toRelativeWorkspacePath(uri: vscode.Uri): string {
  return vscode.workspace.asRelativePath(uri).replace(/\\/g, '/')
}

function emitFileContentChanged(
  sendEvent: (msg: WsMessage) => void,
  path: string,
  isDirty: boolean,
): void {
  debugLog('file.contentChanged', { path, isDirty })
  sendEvent(createMessage('file.contentChanged', { path, isDirty }))
}

// Handle file.read request: read file content (prefer dirty buffer)
export async function handleFileRead(
  msg: WsMessage,
  sendResponse: (msg: WsMessage) => void,
): Promise<void> {
  const payload = msg.payload as { path: string }
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
  if (!workspaceFolder) {
    sendResponse(createMessage('file.read.error', { code: 'NOT_FOUND', message: 'No workspace open' }, msg.id))
    return
  }

  const validation = validatePath(payload.path, workspaceFolder)
  if (!validation.valid) {
    sendResponse(createMessage('file.read.error', { code: 'INVALID_REQUEST', message: validation.reason }, msg.id))
    return
  }
  const fileUri = validation.uri

  try {
    // Check if file is open (may have dirty buffer)
    const doc = vscode.workspace.textDocuments.find(
      (d) => d.uri.fsPath === fileUri.fsPath,
    )

    let content: string
    let isDirty = false
    let languageId = 'plaintext'
    let lineCount = 0

    if (doc) {
      // Use document content (includes unsaved changes)
      content = doc.getText()
      isDirty = doc.isDirty
      languageId = doc.languageId
      lineCount = doc.lineCount
    } else {
      // Read from filesystem
      const rawContent = await vscode.workspace.fs.readFile(fileUri)
      content = new TextDecoder('utf-8').decode(rawContent)
      lineCount = content.split('\n').length
      languageId = getLanguageIdFromPath(payload.path.split('/').pop() ?? '') ?? 'plaintext'
    }

    sendResponse(createMessage('file.read.result', {
      path: payload.path,
      content,
      languageId,
      isDirty,
      encoding: 'utf-8',
      lineCount,
    }, msg.id))
  } catch (err) {
    sendResponse(createMessage('file.read.error', {
      code: 'NOT_FOUND',
      message: `File not found: ${payload.path}`,
    }, msg.id))
  }
}

export function startFileContentWatch(
  path: string,
  sendEvent: (msg: WsMessage) => void,
): vscode.Disposable[] {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
  if (!workspaceFolder) return []

  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(workspaceFolder, escapeGlobPattern(path)),
  )
  debugLog('startFileContentWatch', { path, workspace: workspaceFolder.uri.fsPath })

  const notify = () => {
    debugLog('fileContentFsEvent', { path, source: 'fs' })
    emitFileContentChanged(sendEvent, path, false)
  }

  const onCreated = watcher.onDidCreate(() => notify())
  const onDeleted = watcher.onDidDelete(() => notify())
  const onChanged = watcher.onDidChange(() => notify())

  return [watcher, onCreated, onDeleted, onChanged]
}

export function startFileContentDocumentWatch(
  getWatchedPaths: () => ReadonlySet<string>,
  sendEvent: (msg: WsMessage) => void,
): vscode.Disposable {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  debugLog('startFileContentDocumentWatch')
  const listener = vscode.workspace.onDidChangeTextDocument((e) => {
    const path = toRelativeWorkspacePath(e.document.uri)
    if (!getWatchedPaths().has(path)) return

    const existingTimer = timers.get(path)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    const timer = setTimeout(() => {
      timers.delete(path)
      debugLog('fileContentDocumentEvent', { path, isDirty: e.document.isDirty, source: 'textDocument' })
      emitFileContentChanged(sendEvent, path, e.document.isDirty)
    }, 300)

    timers.set(path, timer)
  })

  return {
    dispose() {
      debugLog('disposeFileContentDocumentWatch')
      listener.dispose()
      for (const timer of timers.values()) {
        clearTimeout(timer)
      }
      timers.clear()
    },
  }
}
