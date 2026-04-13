import type { Workspace } from '@code-viewer/shared'

const STORAGE_KEY = 'code-viewer:selected-workspace'

interface WorkspaceIdentity {
  extensionId: string
  workspaceKey: string
  rootPath: string
}

export function readStoredWorkspace(): Workspace | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Workspace) : null
  } catch {
    return null
  }
}

export function writeStoredWorkspace(workspace: Workspace | null): void {
  try {
    if (workspace) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace))
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    // ignore
  }
}

export function findMatchingWorkspace(
  storedWorkspace: Pick<Workspace, 'workspaceKey' | 'rootPath' | 'extensionId'> | null | undefined,
  liveWorkspaces: WorkspaceIdentity[],
): WorkspaceIdentity | null {
  if (!storedWorkspace) return null

  return liveWorkspaces.find((workspace) => workspace.workspaceKey === storedWorkspace.workspaceKey)
    ?? liveWorkspaces.find((workspace) => workspace.rootPath === storedWorkspace.rootPath)
    ?? liveWorkspaces.find((workspace) => workspace.extensionId === storedWorkspace.extensionId)
    ?? null
}

export function isSameWorkspace(
  left: Pick<Workspace, 'workspaceKey' | 'rootPath' | 'extensionId'> | null | undefined,
  right: Pick<Workspace, 'workspaceKey' | 'rootPath' | 'extensionId'> | null | undefined,
): boolean {
  if (!left || !right) return false
  if (left.workspaceKey && right.workspaceKey) return left.workspaceKey === right.workspaceKey
  if (left.rootPath && right.rootPath) return left.rootPath === right.rootPath
  return left.extensionId === right.extensionId
}
