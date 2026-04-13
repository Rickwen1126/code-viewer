interface WorkspaceLike {
  workspaceKey?: string | null
  extensionId?: string | null
}

export interface FileScrollSnapshot {
  scrollTop: number
  contentLength: number
  timestamp: number
}

export function getWorkspaceFileScrollKey(
  workspace: WorkspaceLike | null | undefined,
  path: string,
): string | null {
  if (!workspace?.workspaceKey) return null
  return `code-viewer:scroll:${workspace.workspaceKey}:${path}`
}

export function getLegacyWorkspaceFileScrollKey(
  workspace: WorkspaceLike | null | undefined,
  path: string,
): string | null {
  if (!workspace?.extensionId) return null
  return `code-viewer:scroll:${workspace.extensionId}:${path}`
}

export function readSavedFileScroll(
  workspace: WorkspaceLike | null | undefined,
  path: string,
): FileScrollSnapshot | null {
  try {
    const stableKey = getWorkspaceFileScrollKey(workspace, path)
    if (stableKey) {
      const stableValue = localStorage.getItem(stableKey)
      if (stableValue) return JSON.parse(stableValue) as FileScrollSnapshot
    }

    const legacyKey = getLegacyWorkspaceFileScrollKey(workspace, path)
    if (legacyKey) {
      const legacyValue = localStorage.getItem(legacyKey)
      if (legacyValue) return JSON.parse(legacyValue) as FileScrollSnapshot
    }

    return null
  } catch {
    return null
  }
}

export function writeSavedFileScroll(
  workspace: WorkspaceLike | null | undefined,
  path: string,
  snapshot: FileScrollSnapshot,
): void {
  try {
    const stableKey = getWorkspaceFileScrollKey(workspace, path)
    if (stableKey) {
      localStorage.setItem(stableKey, JSON.stringify(snapshot))
    }
  } catch {
    // ignore
  }
}
