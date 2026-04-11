export function isDebugEnabled(): boolean {
  try {
    return localStorage.getItem('code-viewer:debug') === 'true'
  } catch {
    return false
  }
}

export function debugLog(scope: string, ...args: unknown[]): void {
  if (!isDebugEnabled()) return
  console.log(`[${scope}]`, ...args)
}
