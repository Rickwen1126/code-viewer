import type { NavigateFunction } from 'react-router'

function encodePathSegments(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

export function buildTourStepUrl(tourId: string, step: number): string {
  const searchParams = new URLSearchParams()
  if (Number.isFinite(step) && step >= 1) {
    searchParams.set('step', String(Math.trunc(step)))
  }
  const encodedTourId = encodeURIComponent(tourId)
  return searchParams.size > 0
    ? `/tours/${encodedTourId}?${searchParams.toString()}`
    : `/tours/${encodedTourId}`
}

export function buildOpenFileUrl(
  workspaceRef: string,
  path: string,
  query: { line?: number; endLine?: number } = {},
): string {
  const searchParams = new URLSearchParams()
  searchParams.set('workspace', workspaceRef)
  searchParams.set('path', path)
  if (Number.isFinite(query.line) && query.line != null && query.line >= 1) {
    searchParams.set('line', String(Math.trunc(query.line)))
  }
  if (
    Number.isFinite(query.endLine) &&
    query.endLine != null &&
    query.line != null &&
    query.endLine >= query.line
  ) {
    searchParams.set('endLine', String(Math.trunc(query.endLine)))
  }
  return `/open/file?${searchParams.toString()}`
}

export function buildGitDiffUrl(
  path: string,
  query: { commit?: string; status?: string } = {},
): string {
  const searchParams = new URLSearchParams()
  if (query.commit) searchParams.set('commit', query.commit)
  if (query.status) searchParams.set('status', query.status)
  const routePath = `/git/diff/${encodePathSegments(path)}`
  return searchParams.size > 0 ? `${routePath}?${searchParams.toString()}` : routePath
}

export function parsePositiveIntQuery(
  searchParams: URLSearchParams,
  key: string,
): number | null {
  const raw = searchParams.get(key)
  if (!raw) return null
  const value = Number(raw)
  if (!Number.isFinite(value)) return null
  const normalized = Math.trunc(value)
  return normalized >= 1 ? normalized : null
}

export type DetourAnchorKind = 'tour' | 'git-diff'

export interface DetourAnchor {
  kind: DetourAnchorKind
  url: string
  label: string
  historyIndex: number | null
}

export interface DetourState {
  detourAnchor?: DetourAnchor
}

export function getCurrentHistoryIndex(): number | null {
  if (typeof window === 'undefined') return null
  const raw = (window.history.state as { idx?: unknown } | null)?.idx
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
}

export function createDetourAnchor(kind: DetourAnchorKind, url: string): DetourAnchor {
  return {
    kind,
    url,
    label: kind === 'tour' ? 'Back to Tour' : 'Back to Diff',
    historyIndex: getCurrentHistoryIndex(),
  }
}

export function mergeDetourState(detourAnchor: DetourAnchor | null | undefined): DetourState | undefined {
  return detourAnchor ? { detourAnchor } : undefined
}

export function getDetourAnchor(state: unknown): DetourAnchor | null {
  if (!state || typeof state !== 'object') return null
  const candidate = (state as DetourState).detourAnchor
  if (!candidate) return null
  if ((candidate.kind !== 'tour' && candidate.kind !== 'git-diff') || !candidate.url || !candidate.label) return null
  return candidate
}

export function unwindToDetourAnchor(
  navigate: NavigateFunction,
  detourAnchor: DetourAnchor | null,
): boolean {
  if (!detourAnchor) return false

  const currentIndex = getCurrentHistoryIndex()
  if (
    currentIndex != null &&
    detourAnchor.historyIndex != null &&
    currentIndex > detourAnchor.historyIndex
  ) {
    navigate(detourAnchor.historyIndex - currentIndex)
    return true
  }

  navigate(detourAnchor.url, { replace: true })
  return true
}
