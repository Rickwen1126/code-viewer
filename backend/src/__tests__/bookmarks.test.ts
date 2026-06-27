import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BookmarkStore, makeBookmarkId } from '../storage/bookmarks.js'

describe('BookmarkStore', () => {
  let dir: string
  let store: BookmarkStore

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bookmarks-test-'))
    store = new BookmarkStore(dir)
    await store.init()
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  describe('makeBookmarkId', () => {
    it('creates file-level id', () => {
      expect(makeBookmarkId('src/app.ts')).toBe('src/app.ts:file')
    })

    it('creates line-level id', () => {
      expect(makeBookmarkId('src/app.ts', 42)).toBe('src/app.ts:42')
    })
  })

  describe('list', () => {
    it('returns empty array for new workspace', async () => {
      const result = await store.list('ws_test')
      expect(result).toEqual([])
    })

    it('returns cached result on second call', async () => {
      await store.add('ws_test', { path: 'a.ts', preview: 'file a' })
      const first = await store.list('ws_test')
      const second = await store.list('ws_test')
      expect(first).toBe(second)
    })
  })

  describe('add', () => {
    it('adds a file-level bookmark', async () => {
      const bookmark = await store.add('ws_test', { path: 'src/app.ts', preview: 'app.ts' })
      expect(bookmark).toMatchObject({
        id: 'src/app.ts:file',
        path: 'src/app.ts',
        preview: 'app.ts',
      })
      expect(bookmark.line).toBeUndefined()
      expect(bookmark.createdAt).toBeGreaterThan(0)
    })

    it('adds a line-level bookmark', async () => {
      const bookmark = await store.add('ws_test', { path: 'src/app.ts', line: 10, preview: 'const x = 1' })
      expect(bookmark).toMatchObject({
        id: 'src/app.ts:10',
        path: 'src/app.ts',
        line: 10,
        preview: 'const x = 1',
      })
    })

    it('deduplicates by id', async () => {
      const first = await store.add('ws_test', { path: 'a.ts', preview: 'a' })
      const second = await store.add('ws_test', { path: 'a.ts', preview: 'a different preview' })
      expect(second).toBe(first)
      const all = await store.list('ws_test')
      expect(all).toHaveLength(1)
    })

    it('truncates preview to 60 chars', async () => {
      const long = 'x'.repeat(100)
      const bookmark = await store.add('ws_test', { path: 'a.ts', preview: long })
      expect(bookmark.preview).toHaveLength(60)
    })

    it('persists to disk', async () => {
      await store.add('ws_test', { path: 'a.ts', preview: 'a' })
      const raw = await readFile(join(dir, 'ws_test.json'), 'utf-8')
      const data = JSON.parse(raw)
      expect(data.version).toBe(1)
      expect(data.bookmarks).toHaveLength(1)
      expect(data.bookmarks[0].id).toBe('a.ts:file')
    })
  })

  describe('remove', () => {
    it('removes an existing bookmark', async () => {
      await store.add('ws_test', { path: 'a.ts', preview: 'a' })
      const removed = await store.remove('ws_test', 'a.ts:file')
      expect(removed).toBe(true)
      const all = await store.list('ws_test')
      expect(all).toHaveLength(0)
    })

    it('returns false for non-existent bookmark', async () => {
      const removed = await store.remove('ws_test', 'nonexistent:file')
      expect(removed).toBe(false)
    })
  })

  describe('import', () => {
    it('merges incoming bookmarks without duplicates', async () => {
      await store.add('ws_test', { path: 'a.ts', preview: 'a' })
      const result = await store.import('ws_test', [
        { path: 'a.ts', preview: 'a' },
        { path: 'b.ts', preview: 'b' },
        { path: 'c.ts', line: 5, preview: 'line 5' },
      ])
      expect(result).toHaveLength(3)
      expect(result.map(b => b.id)).toEqual(['a.ts:file', 'b.ts:file', 'c.ts:5'])
    })

    it('preserves createdAt from incoming data', async () => {
      const result = await store.import('ws_test', [
        { path: 'a.ts', preview: 'a', createdAt: 1000 },
      ])
      expect(result[0].createdAt).toBe(1000)
    })
  })

  describe('concurrent writes', () => {
    it('serializes concurrent adds to the same workspace', async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        store.add('ws_test', { path: `file${i}.ts`, preview: `file ${i}` })
      )
      await Promise.all(promises)
      const all = await store.list('ws_test')
      expect(all).toHaveLength(10)
    })
  })

  describe('data survives fresh store instance', () => {
    it('reads bookmarks written by a previous instance', async () => {
      await store.add('ws_test', { path: 'a.ts', preview: 'a' })
      await store.add('ws_test', { path: 'b.ts', line: 5, preview: 'line 5' })

      const store2 = new BookmarkStore(dir)
      await store2.init()
      const all = await store2.list('ws_test')
      expect(all).toHaveLength(2)
      expect(all[0].id).toBe('a.ts:file')
      expect(all[1].id).toBe('b.ts:5')
    })
  })
})
