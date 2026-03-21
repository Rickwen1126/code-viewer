import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { SessionCache } from '../cache/session.js'
import type { FileTreeNode } from '@code-viewer/shared'

function makeNodes(count: number): FileTreeNode[] {
  return Array.from({ length: count }, (_, i) => ({
    path: `/src/file${i}.ts`,
    name: `file${i}.ts`,
    type: 'file' as const,
    isGitIgnored: false,
    isDirty: false,
  }))
}

describe('SessionCache', () => {
  let cache: SessionCache

  beforeEach(() => {
    vi.useFakeTimers()
    cache = new SessionCache()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('setFileTree / getFileTree', () => {
    it('stores and retrieves a file tree', () => {
      const nodes = makeNodes(3)
      cache.setFileTree('ext-1', nodes)
      expect(cache.getFileTree('ext-1')).toEqual(nodes)
    })

    it('returns null for a missing key', () => {
      expect(cache.getFileTree('does-not-exist')).toBeNull()
    })

    it('returns the same reference that was stored', () => {
      const nodes = makeNodes(2)
      cache.setFileTree('ext-1', nodes)
      const result = cache.getFileTree('ext-1')
      expect(result).toBe(nodes)
    })

    it('overwrites an existing entry on second set', () => {
      const first = makeNodes(1)
      const second = makeNodes(5)
      cache.setFileTree('ext-1', first)
      cache.setFileTree('ext-1', second)
      expect(cache.getFileTree('ext-1')).toEqual(second)
      expect(cache.getFileTree('ext-1')).not.toEqual(first)
    })
  })

  describe('TTL expiry', () => {
    it('returns null after the 5-minute TTL has elapsed', () => {
      const nodes = makeNodes(2)
      cache.setFileTree('ext-1', nodes)

      // Just before expiry — still valid
      vi.advanceTimersByTime(5 * 60 * 1000 - 1)
      expect(cache.getFileTree('ext-1')).toEqual(nodes)

      // One millisecond past expiry — should be gone
      vi.advanceTimersByTime(2)
      expect(cache.getFileTree('ext-1')).toBeNull()
    })

    it('cleans up the internal cache entry when it returns null after TTL', () => {
      const nodes = makeNodes(1)
      cache.setFileTree('ext-1', nodes)

      vi.advanceTimersByTime(5 * 60 * 1000 + 1)
      // First call deletes the entry and returns null
      expect(cache.getFileTree('ext-1')).toBeNull()
      // Subsequent call also returns null (entry was deleted)
      expect(cache.getFileTree('ext-1')).toBeNull()
    })

    it('a freshly set entry is valid even after a stale read of a different entry', () => {
      const nodes = makeNodes(2)
      cache.setFileTree('ext-1', nodes)

      vi.advanceTimersByTime(5 * 60 * 1000 + 1)

      // ext-2 was set after the timer advance
      const fresh = makeNodes(3)
      cache.setFileTree('ext-2', fresh)

      expect(cache.getFileTree('ext-1')).toBeNull()
      expect(cache.getFileTree('ext-2')).toEqual(fresh)
    })
  })

  describe('invalidateExtension', () => {
    it('removes the cached entry', () => {
      const nodes = makeNodes(2)
      cache.setFileTree('ext-1', nodes)
      cache.invalidateExtension('ext-1')
      expect(cache.getFileTree('ext-1')).toBeNull()
    })

    it('is a no-op when the key does not exist', () => {
      expect(() => cache.invalidateExtension('ghost')).not.toThrow()
    })
  })

  describe('multiple extensions', () => {
    it('caches entries independently per extensionId', () => {
      const a = makeNodes(1)
      const b = makeNodes(2)
      const c = makeNodes(3)
      cache.setFileTree('ext-a', a)
      cache.setFileTree('ext-b', b)
      cache.setFileTree('ext-c', c)

      expect(cache.getFileTree('ext-a')).toEqual(a)
      expect(cache.getFileTree('ext-b')).toEqual(b)
      expect(cache.getFileTree('ext-c')).toEqual(c)
    })

    it('invalidating one extension does not affect others', () => {
      const a = makeNodes(1)
      const b = makeNodes(2)
      cache.setFileTree('ext-a', a)
      cache.setFileTree('ext-b', b)

      cache.invalidateExtension('ext-a')

      expect(cache.getFileTree('ext-a')).toBeNull()
      expect(cache.getFileTree('ext-b')).toEqual(b)
    })

    it('TTL expiry is independent per extension', () => {
      const a = makeNodes(1)
      cache.setFileTree('ext-a', a)

      vi.advanceTimersByTime(4 * 60 * 1000)

      // ext-b set 4 minutes after ext-a
      const b = makeNodes(2)
      cache.setFileTree('ext-b', b)

      // Advance 2 more minutes — ext-a (6 min total) is stale, ext-b (2 min) is not
      vi.advanceTimersByTime(2 * 60 * 1000)

      expect(cache.getFileTree('ext-a')).toBeNull()
      expect(cache.getFileTree('ext-b')).toEqual(b)
    })
  })
})
