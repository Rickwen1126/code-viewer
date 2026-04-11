import * as vscode from 'vscode'

export function isDebugEnabled(): boolean {
  return vscode.workspace.getConfiguration('codeViewer').get<boolean>('debug', false)
}

export function debugLog(...args: unknown[]): void {
  if (!isDebugEnabled()) return
  console.log('[CodeViewer]', ...args)
}
