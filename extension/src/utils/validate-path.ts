import * as path from 'path'
import * as vscode from 'vscode'

/**
 * Validates that a requested path is safe to access.
 * Allows: paths within workspace, or files currently open in VS Code.
 * Blocks: path traversal attempts (../) that escape workspace.
 */
export function validatePath(
  requestedPath: string,
  workspaceFolder: vscode.WorkspaceFolder,
): { valid: true; uri: vscode.Uri } | { valid: false; reason: string } {
  const rootFsPath = workspaceFolder.uri.fsPath
  const resolved = path.resolve(rootFsPath, requestedPath)

  // Check 1: Is it within the workspace?
  if (resolved.startsWith(rootFsPath + path.sep) || resolved === rootFsPath) {
    return { valid: true, uri: vscode.Uri.file(resolved) }
  }

  // Check 2: Is it an open document in VS Code? (e.g., Go to Definition jumped to node_modules outside workspace)
  const isOpenDoc = vscode.workspace.textDocuments.some(
    (d) => d.uri.fsPath === resolved,
  )
  if (isOpenDoc) {
    return { valid: true, uri: vscode.Uri.file(resolved) }
  }

  return { valid: false, reason: 'Path outside workspace' }
}
