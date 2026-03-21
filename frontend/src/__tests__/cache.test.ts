import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { FileTreeNode, FileContent, GitStatus, ChatSession, ChatTurn } from '@code-viewer/shared'

// ---------------------------------------------------------------------------
// Mock the `idb` module.
//
// cache.ts calls:
//   db.get(storeName, key)              → returns stored value or undefined
//   db.put(storeName, value, key)       → stores value under key
//   db.delete(storeName, key)           → removes entry
//
// We maintain a simple in-memory Map keyed by "<store>:<key>".
// ---------------------------------------------------------------------------

const mockStore = new Map<string, unknown>()

vi.mock('idb', () => ({
  openDB: vi.fn(() =>
    Promise.resolve({
      get: vi.fn((store: string, key: string) =>
        Promise.resolve(mockStore.get(`${store}:${key}`)),
      ),
      put: vi.fn((store: string, value: unknown, key: string) => {
        mockStore.set(`${store}:${key}`, value)
        return Promise.resolve()
      }),
      delete: vi.fn((store: string, key: string) => {
        mockStore.delete(`${store}:${key}`)
        return Promise.resolve()
      }),
    }),
  ),
}))

// Import AFTER the mock so the module uses the mocked openDB.
// eslint-disable-next-line import/first
import { cacheService } from '../services/cache.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sampleFileTree: FileTreeNode[] = [
  {
    path: '/src',
    name: 'src',
    type: 'directory',
    isGitIgnored: false,
    isDirty: false,
    children: [],
  },
]

const sampleFileContent: FileContent = {
  path: '/src/index.ts',
  content: 'export default {}',
  languageId: 'typescript',
  isDirty: false,
  encoding: 'utf-8',
  lineCount: 1,
}

const sampleGitStatus: GitStatus = {
  branch: 'main',
  ahead: 0,
  behind: 0,
  changedFiles: [],
}

const sampleSession: ChatSession = {
  id: 'session-1',
  title: 'My Chat',
  createdAt: 1000,
  lastActiveAt: 2000,
  turnCount: 1,
  mode: 'ask',
}

const sampleTurns: ChatTurn[] = [
  {
    id: 'turn-1',
    sessionId: 'session-1',
    request: 'Hello',
    response: 'Hi there',
    responseStatus: 'complete',
    timestamp: 1500,
  },
]

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('cacheService', () => {
  beforeEach(() => {
    // Wipe in-memory store between tests so they are independent.
    mockStore.clear()
  })

  // ── file-tree ─────────────────────────────────────────────────────────────

  describe('setFileTree / getFileTree', () => {
    it('should store and retrieve a file tree', async () => {
      await cacheService.setFileTree('ext-1', sampleFileTree)
      const result = await cacheService.getFileTree('ext-1')
      expect(result).toEqual(sampleFileTree)
    })

    it('should return null for a missing key', async () => {
      const result = await cacheService.getFileTree('no-such-extension')
      expect(result).toBeNull()
    })

    it('should overwrite an existing entry', async () => {
      await cacheService.setFileTree('ext-1', sampleFileTree)
      const updated: FileTreeNode[] = [{ ...sampleFileTree[0], name: 'updated-src' }]
      await cacheService.setFileTree('ext-1', updated)
      const result = await cacheService.getFileTree('ext-1')
      expect(result?.[0].name).toBe('updated-src')
    })
  })

  // ── file-content ──────────────────────────────────────────────────────────

  describe('setFileContent / getFileContent', () => {
    it('should store and retrieve file content', async () => {
      await cacheService.setFileContent('ext-1', '/src/index.ts', sampleFileContent)
      const result = await cacheService.getFileContent('ext-1', '/src/index.ts')
      expect(result).toEqual(sampleFileContent)
    })

    it('should return null for a missing key', async () => {
      const result = await cacheService.getFileContent('ext-1', '/not/here.ts')
      expect(result).toBeNull()
    })

    it('should return null after the 24 h TTL expires', async () => {
      const now = Date.now()
      // Store entry as if it was saved 25 hours ago
      const TWO_DAYS_MS = 25 * 60 * 60 * 1000
      mockStore.set('file-content:ext-1:/src/old.ts', {
        content: sampleFileContent,
        updatedAt: now - TWO_DAYS_MS,
      })

      const result = await cacheService.getFileContent('ext-1', '/src/old.ts')
      expect(result).toBeNull()
    })

    it('should return data that is within the 24 h TTL', async () => {
      const now = Date.now()
      // Store entry as if it was saved 1 hour ago (well within TTL)
      mockStore.set('file-content:ext-1:/src/fresh.ts', {
        content: sampleFileContent,
        updatedAt: now - 60 * 60 * 1000,
      })

      const result = await cacheService.getFileContent('ext-1', '/src/fresh.ts')
      expect(result).toEqual(sampleFileContent)
    })
  })

  // ── git-status ────────────────────────────────────────────────────────────

  describe('setGitStatus / getGitStatus', () => {
    it('should store and retrieve git status', async () => {
      await cacheService.setGitStatus('ext-1', sampleGitStatus)
      const result = await cacheService.getGitStatus('ext-1')
      expect(result).toEqual(sampleGitStatus)
    })

    it('should return null for a missing key', async () => {
      const result = await cacheService.getGitStatus('no-such-ext')
      expect(result).toBeNull()
    })
  })

  // ── chat-sessions ─────────────────────────────────────────────────────────

  describe('setChatSession / getChatSession', () => {
    it('should store and retrieve a chat session with turns', async () => {
      await cacheService.setChatSession(sampleSession, sampleTurns)
      const result = await cacheService.getChatSession('session-1')
      expect(result).not.toBeNull()
      expect(result!.session).toEqual(sampleSession)
      expect(result!.turns).toEqual(sampleTurns)
    })

    it('should return null for a missing session id', async () => {
      const result = await cacheService.getChatSession('does-not-exist')
      expect(result).toBeNull()
    })

    it('should overwrite an existing session', async () => {
      await cacheService.setChatSession(sampleSession, sampleTurns)

      const updatedSession: ChatSession = { ...sampleSession, title: 'Updated Title' }
      const newTurn: ChatTurn = {
        id: 'turn-2',
        sessionId: 'session-1',
        request: 'Another question',
        response: 'Another answer',
        responseStatus: 'complete',
        timestamp: 3000,
      }
      await cacheService.setChatSession(updatedSession, [...sampleTurns, newTurn])

      const result = await cacheService.getChatSession('session-1')
      expect(result!.session.title).toBe('Updated Title')
      expect(result!.turns).toHaveLength(2)
    })
  })
})
