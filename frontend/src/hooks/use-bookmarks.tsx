import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { useWorkspace } from './use-workspace'
import { useWebSocket } from './use-websocket'
import { wsClient } from '../services/ws-client'
import type {
  Bookmark,
  BookmarkListResultPayload,
  BookmarkAddResultPayload,
  BookmarkRemoveResultPayload,
  BookmarkImportResultPayload,
  BookmarkChangedPayload,
} from '@code-viewer/shared'

interface BookmarkContextValue {
  bookmarks: Bookmark[]
  addBookmark: (path: string, line: number | undefined, preview: string) => void
  removeBookmark: (bookmarkId: string) => void
  isFileBookmarked: (path: string) => boolean
  isLineBookmarked: (path: string, line: number) => boolean
  getBookmarksForFile: (path: string) => Bookmark[]
  getBookmarkedLines: (path: string) => Set<number>
}

const BookmarkContext = createContext<BookmarkContextValue>({
  bookmarks: [],
  addBookmark: () => {},
  removeBookmark: () => {},
  isFileBookmarked: () => false,
  isLineBookmarked: () => false,
  getBookmarksForFile: () => [],
  getBookmarkedLines: () => new Set(),
})

function makeBookmarkId(path: string, line?: number): string {
  return `${path}:${line ?? 'file'}`
}

export function BookmarkProvider({ children }: { children: React.ReactNode }) {
  const { workspace } = useWorkspace()
  const { connectionState, request } = useWebSocket()
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const migrationDone = useRef(false)

  // Fetch bookmarks from server on workspace connect
  useEffect(() => {
    if (connectionState !== 'connected' || !workspace?.workspaceKey) {
      return
    }

    let cancelled = false
    const workspaceKey = workspace.workspaceKey

    void (async () => {
      try {
        const res = await request<{ workspaceKey: string }, BookmarkListResultPayload>(
          'bookmark.list',
          { workspaceKey },
        )
        if (!cancelled) {
          setBookmarks(res.payload.bookmarks)
        }
      } catch {
        if (!cancelled) {
          setBookmarks([])
        }
      }

      // One-time migration from localStorage
      if (!cancelled && !migrationDone.current) {
        migrationDone.current = true
        migrateFromLocalStorage(workspaceKey)
      }
    })()

    return () => { cancelled = true }
  }, [connectionState, workspace?.workspaceKey])

  // Subscribe to bookmark.changed for cross-device sync
  useEffect(() => {
    if (!workspace?.workspaceKey) return

    const workspaceKey = workspace.workspaceKey
    const unsub = wsClient.subscribe('bookmark.changed', (msg) => {
      const payload = msg.payload as BookmarkChangedPayload
      if (payload.workspaceKey === workspaceKey) {
        setBookmarks(payload.bookmarks)
      }
    })

    return unsub
  }, [workspace?.workspaceKey])

  function migrateFromLocalStorage(workspaceKey: string) {
    try {
      const toMigrate: Array<{ path: string; line?: number; preview: string; createdAt?: number }> = []

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (!key?.startsWith('code-viewer:bookmarks:')) continue

        try {
          const raw = localStorage.getItem(key)
          if (!raw) continue
          const items = JSON.parse(raw) as Array<{ path: string; line?: number; preview: string; createdAt?: number }>
          if (Array.isArray(items)) {
            toMigrate.push(...items)
          }
        } catch { /* skip malformed */ }
      }

      if (toMigrate.length === 0) return

      void request<{ workspaceKey: string; bookmarks: typeof toMigrate }, BookmarkImportResultPayload>(
        'bookmark.import',
        { workspaceKey, bookmarks: toMigrate },
      ).then((res) => {
        setBookmarks(res.payload.bookmarks)
        // Clear migrated localStorage entries
        const keysToRemove: string[] = []
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i)
          if (key?.startsWith('code-viewer:bookmarks:')) {
            keysToRemove.push(key)
          }
        }
        for (const key of keysToRemove) {
          localStorage.removeItem(key)
        }
      }).catch(() => {
        // Migration failed — will retry next session
        migrationDone.current = false
      })
    } catch { /* localStorage unavailable */ }
  }

  const addBookmark = useCallback((path: string, line: number | undefined, preview: string) => {
    const workspaceKey = workspace?.workspaceKey
    if (!workspaceKey) return

    // Optimistic update
    const id = makeBookmarkId(path, line)
    setBookmarks(prev => {
      if (prev.some(b => b.id === id)) return prev
      return [...prev, {
        id,
        path,
        ...(line !== undefined ? { line } : {}),
        preview: preview.slice(0, 60).trim(),
        createdAt: Date.now(),
      }]
    })

    void request<{ workspaceKey: string; path: string; line?: number; preview: string }, BookmarkAddResultPayload>(
      'bookmark.add',
      { workspaceKey, path, ...(line !== undefined ? { line } : {}), preview },
    ).catch(() => {
      // Rollback on failure
      setBookmarks(prev => prev.filter(b => b.id !== id))
    })
  }, [workspace?.workspaceKey, request])

  const removeBookmark = useCallback((bookmarkId: string) => {
    const workspaceKey = workspace?.workspaceKey
    if (!workspaceKey) return

    // Optimistic update
    let removed: Bookmark | undefined
    setBookmarks(prev => {
      removed = prev.find(b => b.id === bookmarkId)
      return prev.filter(b => b.id !== bookmarkId)
    })

    void request<{ workspaceKey: string; bookmarkId: string }, BookmarkRemoveResultPayload>(
      'bookmark.remove',
      { workspaceKey, bookmarkId },
    ).catch(() => {
      // Rollback on failure
      if (removed) {
        setBookmarks(prev => [...prev, removed!])
      }
    })
  }, [workspace?.workspaceKey, request])

  const isFileBookmarked = useCallback((path: string) => {
    return bookmarks.some(b => b.path === path && b.line == null)
  }, [bookmarks])

  const isLineBookmarked = useCallback((path: string, line: number) => {
    return bookmarks.some(b => b.path === path && b.line === line)
  }, [bookmarks])

  const getBookmarksForFile = useCallback((path: string) => {
    return bookmarks.filter(b => b.path === path)
  }, [bookmarks])

  const getBookmarkedLines = useCallback((path: string) => {
    return new Set(
      bookmarks
        .filter(b => b.path === path && b.line != null)
        .map(b => b.line!)
    )
  }, [bookmarks])

  return (
    <BookmarkContext.Provider value={{
      bookmarks,
      addBookmark,
      removeBookmark,
      isFileBookmarked,
      isLineBookmarked,
      getBookmarksForFile,
      getBookmarkedLines,
    }}>
      {children}
    </BookmarkContext.Provider>
  )
}

export function useBookmarks() {
  return useContext(BookmarkContext)
}
