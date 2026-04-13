interface WorkspaceLike {
  workspaceKey?: string | null
  rootPath?: string | null
  extensionId?: string | null
}

interface LastLocationSnapshot {
  workspaceKey?: string | null
  rootPath?: string | null
  extensionId?: string | null
  href: string
}

const STORAGE_KEY = 'code-viewer:last-location'

function hasPositiveStepQuery(search: string): boolean {
  const raw = new URLSearchParams(search).get('step')
  if (!raw) return false
  const value = Number(raw)
  return Number.isFinite(value) && Math.trunc(value) >= 1
}

export function isRestorableLocation(pathname: string, search = ''): boolean {
  if (pathname.includes('?') || pathname.includes('#')) return false
  if (pathname.startsWith('/files/')) return pathname.length > '/files/'.length
  if (pathname.startsWith('/git/diff/')) return pathname.length > '/git/diff/'.length
  if (/^\/tours\/[^/]+$/.test(pathname)) return hasPositiveStepQuery(search)
  return false
}

function matchesWorkspace(
  workspace: WorkspaceLike | null | undefined,
  snapshot: LastLocationSnapshot,
): boolean {
  if (!workspace) return false
  if (workspace.workspaceKey && snapshot.workspaceKey) {
    return workspace.workspaceKey === snapshot.workspaceKey
  }
  if (workspace.rootPath && snapshot.rootPath) {
    return workspace.rootPath === snapshot.rootPath
  }
  return Boolean(workspace.extensionId && snapshot.extensionId && workspace.extensionId === snapshot.extensionId)
}

export function readLastLocationForWorkspace(workspace: WorkspaceLike | null | undefined): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null

    const snapshot = JSON.parse(raw) as LastLocationSnapshot
    if (!snapshot?.href || !matchesWorkspace(workspace, snapshot)) return null

    const parsed = new URL(snapshot.href, 'http://localhost')
    if (!isRestorableLocation(parsed.pathname, parsed.search)) return null
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return null
  }
}

export function writeLastLocationForWorkspace(
  workspace: WorkspaceLike | null | undefined,
  href: string,
): void {
  if (!workspace) return

  try {
    const parsed = new URL(href, 'http://localhost')
    if (!isRestorableLocation(parsed.pathname, parsed.search)) return

    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        workspaceKey: workspace.workspaceKey ?? null,
        rootPath: workspace.rootPath ?? null,
        extensionId: workspace.extensionId ?? null,
        href: `${parsed.pathname}${parsed.search}`,
      } satisfies LastLocationSnapshot),
    )
  } catch {
    // ignore
  }
}
