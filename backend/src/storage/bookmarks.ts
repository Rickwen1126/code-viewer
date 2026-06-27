import { readFile, writeFile, rename, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Bookmark } from '@code-viewer/shared'

interface StorageFile {
  version: 1
  bookmarks: Bookmark[]
}

export function makeBookmarkId(path: string, line?: number): string {
  return `${path}:${line ?? 'file'}`
}

export class BookmarkStore {
  private cache = new Map<string, Bookmark[]>()
  private writeQueues = new Map<string, Promise<void>>()

  constructor(private dataDir: string) {}

  async init(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true })
  }

  private filePath(workspaceKey: string): string {
    return join(this.dataDir, `${workspaceKey}.json`)
  }

  private async readFromDisk(workspaceKey: string): Promise<Bookmark[]> {
    try {
      const raw = await readFile(this.filePath(workspaceKey), 'utf-8')
      const data = JSON.parse(raw) as StorageFile
      return Array.isArray(data.bookmarks) ? data.bookmarks : []
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      console.warn(`[bookmarks] Failed to read ${workspaceKey}:`, err)
      return []
    }
  }

  private async writeToDisk(workspaceKey: string, bookmarks: Bookmark[]): Promise<void> {
    const file = this.filePath(workspaceKey)
    const tmp = file + '.tmp'
    const data: StorageFile = { version: 1, bookmarks }
    await writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8')
    await rename(tmp, file)
  }

  private enqueue(workspaceKey: string, fn: () => Promise<void>): Promise<void> {
    const prev = this.writeQueues.get(workspaceKey) ?? Promise.resolve()
    const next = prev.then(fn, fn)
    this.writeQueues.set(workspaceKey, next)
    return next
  }

  async list(workspaceKey: string): Promise<Bookmark[]> {
    const cached = this.cache.get(workspaceKey)
    if (cached) return cached
    const bookmarks = await this.readFromDisk(workspaceKey)
    this.cache.set(workspaceKey, bookmarks)
    return bookmarks
  }

  async add(workspaceKey: string, input: { path: string; line?: number; preview: string }): Promise<Bookmark> {
    const id = makeBookmarkId(input.path, input.line)
    let added!: Bookmark

    await this.enqueue(workspaceKey, async () => {
      const bookmarks = await this.list(workspaceKey)
      const existing = bookmarks.find(b => b.id === id)
      if (existing) {
        added = existing
        return
      }
      added = {
        id,
        path: input.path,
        ...(input.line !== undefined ? { line: input.line } : {}),
        preview: input.preview.slice(0, 60).trim(),
        createdAt: Date.now(),
      }
      const updated = [...bookmarks, added]
      this.cache.set(workspaceKey, updated)
      await this.writeToDisk(workspaceKey, updated)
    })

    return added
  }

  async remove(workspaceKey: string, bookmarkId: string): Promise<boolean> {
    let removed = false

    await this.enqueue(workspaceKey, async () => {
      const bookmarks = await this.list(workspaceKey)
      const filtered = bookmarks.filter(b => b.id !== bookmarkId)
      removed = filtered.length < bookmarks.length
      if (removed) {
        this.cache.set(workspaceKey, filtered)
        await this.writeToDisk(workspaceKey, filtered)
      }
    })

    return removed
  }

  async import(workspaceKey: string, incoming: Array<{ path: string; line?: number; preview: string; createdAt?: number }>): Promise<Bookmark[]> {
    let result!: Bookmark[]

    await this.enqueue(workspaceKey, async () => {
      const existing = await this.list(workspaceKey)
      const existingIds = new Set(existing.map(b => b.id))
      const merged = [...existing]

      for (const item of incoming) {
        const id = makeBookmarkId(item.path, item.line)
        if (existingIds.has(id)) continue
        existingIds.add(id)
        merged.push({
          id,
          path: item.path,
          ...(item.line !== undefined ? { line: item.line } : {}),
          preview: item.preview.slice(0, 60).trim(),
          createdAt: item.createdAt ?? Date.now(),
        })
      }

      this.cache.set(workspaceKey, merged)
      await this.writeToDisk(workspaceKey, merged)
      result = merged
    })

    return result
  }
}
