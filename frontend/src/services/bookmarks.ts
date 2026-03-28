export interface Bookmark {
  path: string       // relative file path
  line: number       // 1-based line number
  preview: string    // first ~60 chars of the line content
  createdAt: number  // timestamp
}

function storageKey(extensionId: string): string {
  return `code-viewer:bookmarks:${extensionId}`
}

export function getBookmarks(extensionId: string): Bookmark[] {
  try {
    const raw = localStorage.getItem(storageKey(extensionId))
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function getBookmarksForFile(extensionId: string, path: string): Bookmark[] {
  return getBookmarks(extensionId).filter(b => b.path === path)
}

export function addBookmark(extensionId: string, path: string, line: number, preview: string): void {
  const bookmarks = getBookmarks(extensionId)
  // Don't add duplicate
  if (bookmarks.some(b => b.path === path && b.line === line)) return
  bookmarks.push({ path, line, preview: preview.slice(0, 60).trim(), createdAt: Date.now() })
  try { localStorage.setItem(storageKey(extensionId), JSON.stringify(bookmarks)) } catch {}
}

export function removeBookmark(extensionId: string, path: string, line: number): void {
  const bookmarks = getBookmarks(extensionId).filter(b => !(b.path === path && b.line === line))
  try { localStorage.setItem(storageKey(extensionId), JSON.stringify(bookmarks)) } catch {}
}

export function isBookmarked(extensionId: string, path: string, line: number): boolean {
  return getBookmarks(extensionId).some(b => b.path === path && b.line === line)
}

export function getBookmarkedLines(extensionId: string, path: string): Set<number> {
  return new Set(getBookmarksForFile(extensionId, path).map(b => b.line))
}
