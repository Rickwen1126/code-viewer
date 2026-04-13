interface WorkspaceLike {
  workspaceKey?: string | null
  extensionId?: string | null
}

const LEGACY_GLOBAL_KEY = 'code-viewer:current-file'

export function getWorkspaceCurrentFileKey(workspace: WorkspaceLike | null | undefined): string | null {
  if (!workspace?.workspaceKey) return null
  return `code-viewer:current-file:${workspace.workspaceKey}`
}

export function getLegacyWorkspaceCurrentFileKey(workspace: WorkspaceLike | null | undefined): string | null {
  if (!workspace?.extensionId) return null
  return `code-viewer:current-file:${workspace.extensionId}`
}

export function readCurrentFileForWorkspace(workspace: WorkspaceLike | null | undefined): string | null {
  try {
    const stableKey = getWorkspaceCurrentFileKey(workspace)
    if (stableKey) {
      const stableValue = localStorage.getItem(stableKey)
      if (stableValue) return stableValue
    }

    const legacyWorkspaceKey = getLegacyWorkspaceCurrentFileKey(workspace)
    if (legacyWorkspaceKey) {
      const legacyValue = localStorage.getItem(legacyWorkspaceKey)
      if (legacyValue) return legacyValue
    }

    return localStorage.getItem(LEGACY_GLOBAL_KEY)
  } catch {
    return null
  }
}

export function writeCurrentFileForWorkspace(workspace: WorkspaceLike | null | undefined, path: string): void {
  try {
    const stableKey = getWorkspaceCurrentFileKey(workspace)
    if (stableKey) {
      localStorage.setItem(stableKey, path)
    }
  } catch {
    // ignore
  }
}
