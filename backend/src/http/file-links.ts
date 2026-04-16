import { networkInterfaces } from 'node:os'
import path from 'node:path/posix'
import {
  buildOpenFileUrl,
  buildOpenGitDiffUrl,
  buildOpenTourUrl,
  type ChangedFile,
  type OpenFileLinkQuery,
  type OpenGitDiffLinkQuery,
  type OpenTourLinkQuery,
} from '@code-viewer/shared'

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

export interface GitDiffLinkRequest extends OpenGitDiffLinkQuery {
  workspaceRef: string
  path: string
}

export interface TourStepLinkRequest extends OpenTourLinkQuery {
  workspaceRef: string
  tourId: string
}

export interface ResolverLinkPayload {
  workspace: Pick<WorkspaceLinkEntry, 'workspaceKey' | 'displayName' | 'gitBranch' | 'extensionVersion' | 'status'>
  resolverPath: string
  localUrl: string
  lanUrl: string | null
  tailscaleUrl: string | null
}

export type ResolverLinkResolution =
  | { kind: 'ok'; payload: ResolverLinkPayload }
  | { kind: 'workspace_not_found' }
  | { kind: 'workspace_not_connected'; workspace: WorkspaceLinkEntry }

export function parsePositiveInt(raw: string | null | undefined): number | undefined {
  if (!raw) return undefined
  const value = Number(raw)
  if (!Number.isFinite(value)) return undefined
  const normalized = Math.trunc(value)
  return normalized >= 1 ? normalized : undefined
}

export function parseGitDiffStatus(raw: string | null | undefined): ChangedFile['status'] | undefined {
  switch (raw) {
    case 'added':
    case 'modified':
    case 'deleted':
    case 'renamed':
      return raw
    default:
      return undefined
  }
}

export function normalizeNonEmptyString(raw: string | null | undefined): string | null {
  if (!raw) return null
  const normalized = raw.trim()
  return normalized ? normalized : null
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

export function getTailscaleIp(): string | null {
  const nets = networkInterfaces()
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal && /^100\./.test(net.address)) {
        return net.address
      }
    }
  }
  return null
}

function resolveWorkspace(
  workspaceRef: string,
  workspaces: WorkspaceLinkEntry[],
): ResolverLinkResolution | WorkspaceLinkEntry {
  const workspace = workspaces.find((entry) =>
    entry.workspaceKey === workspaceRef || entry.rootPath === workspaceRef,
  )
  if (!workspace) {
    return { kind: 'workspace_not_found' }
  }

  if (workspace.status !== 'connected') {
    return { kind: 'workspace_not_connected', workspace }
  }

  return workspace
}

function buildResolverLinkPayload(
  workspace: WorkspaceLinkEntry,
  resolverPath: string,
  options: { lanIp?: string | null; tailscaleIp?: string | null } = {},
): ResolverLinkPayload {
  return {
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
    tailscaleUrl: options.tailscaleIp ? `http://${options.tailscaleIp}:4801${resolverPath}` : null,
  }
}

export function buildFileLinkResponse(
  request: FileLinkRequest,
  workspaces: WorkspaceLinkEntry[],
  options: { lanIp?: string | null; tailscaleIp?: string | null } = {},
): ResolverLinkResolution {
  const resolved = resolveWorkspace(request.workspaceRef, workspaces)
  if ('kind' in resolved) return resolved

  const resolverPath = buildOpenFileUrl(resolved.workspaceKey, request.path, {
    line: request.line,
    endLine: request.endLine,
  })

  return {
    kind: 'ok',
    payload: buildResolverLinkPayload(resolved, resolverPath, options),
  }
}

export function buildGitDiffLinkResponse(
  request: GitDiffLinkRequest,
  workspaces: WorkspaceLinkEntry[],
  options: { lanIp?: string | null; tailscaleIp?: string | null } = {},
): ResolverLinkResolution {
  const resolved = resolveWorkspace(request.workspaceRef, workspaces)
  if ('kind' in resolved) return resolved

  const resolverPath = buildOpenGitDiffUrl(resolved.workspaceKey, request.path, {
    commit: request.commit,
    status: request.status,
  })

  return {
    kind: 'ok',
    payload: buildResolverLinkPayload(resolved, resolverPath, options),
  }
}

export function buildTourStepLinkResponse(
  request: TourStepLinkRequest,
  workspaces: WorkspaceLinkEntry[],
  options: { lanIp?: string | null; tailscaleIp?: string | null } = {},
): ResolverLinkResolution {
  const resolved = resolveWorkspace(request.workspaceRef, workspaces)
  if ('kind' in resolved) return resolved

  const resolverPath = buildOpenTourUrl(resolved.workspaceKey, request.tourId, {
    step: request.step,
  })

  return {
    kind: 'ok',
    payload: buildResolverLinkPayload(resolved, resolverPath, options),
  }
}
