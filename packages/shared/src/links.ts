export interface OpenFileLinkQuery {
  line?: number
  endLine?: number
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
