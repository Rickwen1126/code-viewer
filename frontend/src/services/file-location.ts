export interface FileLocationQuery {
  line?: number
  endLine?: number
}

function normalizeOneBasedLine(value: number | null | undefined): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined
  const normalized = Math.trunc(value)
  return normalized >= 1 ? normalized : undefined
}

export function zeroBasedToOneBasedLine(value: number | null | undefined): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined
  return Math.trunc(value) + 1
}

export function oneBasedToZeroBasedLine(value: number | null | undefined): number | null {
  const normalized = normalizeOneBasedLine(value)
  return normalized == null ? null : normalized - 1
}

export function buildFileRoutePath(path: string): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  return `/files/${encoded}`
}

export function buildFileLocationUrl(path: string, query: FileLocationQuery = {}): string {
  const line = normalizeOneBasedLine(query.line)
  const endLine = normalizeOneBasedLine(query.endLine)
  const searchParams = new URLSearchParams()

  if (line != null) {
    searchParams.set('line', String(line))
    if (endLine != null && endLine >= line) {
      searchParams.set('endLine', String(endLine))
    }
  }

  const routePath = buildFileRoutePath(path)
  return searchParams.size > 0 ? `${routePath}?${searchParams.toString()}` : routePath
}

export function parseFileLocationQuery(searchParams: URLSearchParams): FileLocationQuery {
  const line = normalizeOneBasedLine(Number(searchParams.get('line')))
  const endLine = normalizeOneBasedLine(Number(searchParams.get('endLine')))

  if (line == null) {
    return {}
  }

  if (endLine == null || endLine < line) {
    return { line }
  }

  return { line, endLine }
}

export function buildFileRestoreKey(
  workspaceRef: string,
  path: string,
  query: FileLocationQuery = {},
): string {
  const line = normalizeOneBasedLine(query.line)
  return line != null
    ? `${workspaceRef}:${path}:line:${line}`
    : `${workspaceRef}:${path}:saved-scroll`
}
