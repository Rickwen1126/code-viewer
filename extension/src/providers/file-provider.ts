import * as vscode from 'vscode'
import type { WsMessage } from '@code-viewer/shared'
import type { FileTreeNode } from '@code-viewer/shared'
import { createMessage } from '../ws/client'
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

// Skip events from noisy directories
function shouldSkipEvent(rel: string): boolean {
  return rel.startsWith('node_modules/') || rel.startsWith('.git/')
}

// Watch for file tree changes (create/delete/rename)
export function startFileWatchers(
  sendEvent: (msg: WsMessage) => void,
): vscode.Disposable[] {
  const watcher = vscode.workspace.createFileSystemWatcher('**/*')

  const onCreated = watcher.onDidCreate((uri) => {
    const rel = vscode.workspace.asRelativePath(uri)
    if (shouldSkipEvent(rel)) return
    sendEvent(createMessage('file.treeChanged', {
      changes: [{ type: 'created', path: rel }],
    }))
  })

  const onDeleted = watcher.onDidDelete((uri) => {
    const rel = vscode.workspace.asRelativePath(uri)
    if (shouldSkipEvent(rel)) return
    sendEvent(createMessage('file.treeChanged', {
      changes: [{ type: 'deleted', path: rel }],
    }))
  })

  const onChanged = watcher.onDidChange((uri) => {
    const rel = vscode.workspace.asRelativePath(uri)
    if (shouldSkipEvent(rel)) return
    sendEvent(createMessage('file.treeChanged', {
      changes: [{ type: 'changed', path: rel }],
    }))
  })

  // Watch for dirty buffer changes (debounced to avoid per-keystroke floods)
  let contentChangeTimer: ReturnType<typeof setTimeout> | undefined
  const onDocChanged = vscode.workspace.onDidChangeTextDocument((e) => {
    clearTimeout(contentChangeTimer)
    contentChangeTimer = setTimeout(() => {
      const rel = vscode.workspace.asRelativePath(e.document.uri)
      sendEvent(createMessage('file.contentChanged', {
        path: rel,
        isDirty: e.document.isDirty,
      }))
    }, 300)
  })

  return [watcher, onCreated, onDeleted, onChanged, onDocChanged]
}
