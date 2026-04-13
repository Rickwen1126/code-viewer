export interface OpenFileLinkQuery {
  line?: number
  endLine?: number
}

export interface OpenTourLinkQuery {
  step?: number
}

export interface OpenGitDiffLinkQuery {
  commit?: string
  status?: 'added' | 'modified' | 'deleted' | 'renamed'
}

function normalizePositiveInt(value: number | null | undefined): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined
  const normalized = Math.trunc(value)
  return normalized >= 1 ? normalized : undefined
}

export function buildOpenFileUrl(
  workspaceKey: string,
  path: string,
  query: OpenFileLinkQuery = {},
): string {
  const searchParams = new URLSearchParams()
  searchParams.set('workspace', workspaceKey)
  searchParams.set('path', path)

  const line = normalizePositiveInt(query.line)
  const endLine = normalizePositiveInt(query.endLine)

  if (line != null) {
    searchParams.set('line', String(line))
    if (endLine != null && endLine >= line) {
      searchParams.set('endLine', String(endLine))
    }
  }

  return `/open/file?${searchParams.toString()}`
}

export function buildOpenTourUrl(
  workspaceKey: string,
  tourId: string,
  query: OpenTourLinkQuery = {},
): string {
  const searchParams = new URLSearchParams()
  searchParams.set('workspace', workspaceKey)
  searchParams.set('tourId', tourId)

  const step = normalizePositiveInt(query.step)
  if (step != null) {
    searchParams.set('step', String(step))
  }

  return `/open/tour?${searchParams.toString()}`
}

export function buildOpenGitDiffUrl(
  workspaceKey: string,
  path: string,
  query: OpenGitDiffLinkQuery = {},
): string {
  const searchParams = new URLSearchParams()
  searchParams.set('workspace', workspaceKey)
  searchParams.set('path', path)

  if (query.commit) {
    searchParams.set('commit', query.commit)
  }
  if (query.status) {
    searchParams.set('status', query.status)
  }

  return `/open/git-diff?${searchParams.toString()}`
}
