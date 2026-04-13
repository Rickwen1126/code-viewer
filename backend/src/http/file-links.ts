import { networkInterfaces } from 'node:os'
import path from 'node:path/posix'
import { buildOpenFileUrl, type OpenFileLinkQuery } from '@code-viewer/shared'

export interface WorkspaceLinkEntry {
  extensionId: string
  workspaceKey: string
  displayName: string
  rootPath: string
  gitBranch: string | null
  extensionVersion: string
  status: 'connected' | 'stale'
}

export interface FileLinkRequest extends OpenFileLinkQuery {
  workspaceRef: string
  path: string
}

export interface FileLinkPayload {
  workspace: Pick<WorkspaceLinkEntry, 'workspaceKey' | 'displayName' | 'gitBranch' | 'extensionVersion' | 'status'>
  resolverPath: string
  localUrl: string
  lanUrl: string | null
}

export type FileLinkResolution =
  | { kind: 'ok'; payload: FileLinkPayload }
  | { kind: 'workspace_not_found' }
  | { kind: 'workspace_not_connected'; workspace: WorkspaceLinkEntry }

export function parsePositiveInt(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined
  const value = Number(raw)
  if (!Number.isFinite(value)) return undefined
  const normalized = Math.trunc(value)
  return normalized >= 1 ? normalized : undefined
}

export function normalizeRepoRelativePath(raw: string | null | undefined): string | null {
  if (!raw) return null

  const normalized = path.normalize(raw.replaceAll('\\', '/'))
  if (!normalized || normalized === '.' || normalized.startsWith('../') || path.isAbsolute(normalized)) {
    return null
  }

  return normalized
}

export function getLanIp(): string | null {
  const nets = networkInterfaces()
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) return net.address
    }
  }
  return null
}

export function buildFileLinkResponse(
  request: FileLinkRequest,
  workspaces: WorkspaceLinkEntry[],
  options: { lanIp?: string | null } = {},
): FileLinkResolution {
  const workspace = workspaces.find((entry) =>
    entry.workspaceKey === request.workspaceRef || entry.rootPath === request.workspaceRef,
  )
  if (!workspace) {
    return { kind: 'workspace_not_found' }
  }

  if (workspace.status !== 'connected') {
    return { kind: 'workspace_not_connected', workspace }
  }

  const resolverPath = buildOpenFileUrl(workspace.workspaceKey, request.path, {
    line: request.line,
    endLine: request.endLine,
  })

  return {
    kind: 'ok',
    payload: {
      workspace: {
        workspaceKey: workspace.workspaceKey,
        displayName: workspace.displayName,
        gitBranch: workspace.gitBranch,
        extensionVersion: workspace.extensionVersion,
        status: workspace.status,
      },
      resolverPath,
      localUrl: `http://localhost:4801${resolverPath}`,
      lanUrl: options.lanIp ? `http://${options.lanIp}:4801${resolverPath}` : null,
    },
  }
}
