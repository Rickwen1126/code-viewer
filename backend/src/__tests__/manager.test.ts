import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { ConnectionManager } from '../ws/manager.js'
import type { Workspace } from '@code-viewer/shared'

// Minimal WSContext stand-in — only the `send` method is used in these tests
function createMockWs() {
  const sent: string[] = []
  return {
    ws: { send: (data: string) => sent.push(data) },
    sent,
  }
}

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    extensionId: 'ext-1',
    name: 'My Workspace',
    rootPath: '/home/user/project',
    gitBranch: 'main',
    vscodeVersion: '1.85.0',
    extensionVersion: '0.0.3',
    ...overrides,
  }
}

describe('ConnectionManager', () => {
  let mgr: ConnectionManager

  beforeEach(() => {
    vi.useFakeTimers()
    mgr = new ConnectionManager()
  })

  afterEach(() => {
    mgr.stopHeartbeat()
    vi.useRealTimers()
  })

  // ── Extension CRUD ─────────────────────────────────────────────────

  describe('addExtension / getExtension / removeExtension', () => {
    it('adds and retrieves an extension', () => {
      const { ws } = createMockWs()
      const workspace = makeWorkspace()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mgr.addExtension('ext-1', ws as any, workspace)

      const entry = mgr.getExtension('ext-1')
      expect(entry).toBeDefined()
      expect(entry?.workspace).toEqual(workspace)
      expect(entry?.status).toBe('connected')
      expect(entry?.staleAt).toBeNull()
    })

    it('returns undefined for an extension that was never added', () => {
      expect(mgr.getExtension('ghost')).toBeUndefined()
    })

    it('removes an extension', () => {
      const { ws } = createMockWs()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mgr.addExtension('ext-1', ws as any, makeWorkspace())
      mgr.removeExtension('ext-1')
      expect(mgr.getExtension('ext-1')).toBeUndefined()
    })

    it('removeExtension is a no-op for unknown id', () => {
      expect(() => mgr.removeExtension('ghost')).not.toThrow()
    })

    it('stores lastHeartbeat close to Date.now()', () => {
      const before = Date.now()
      const { ws } = createMockWs()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mgr.addExtension('ext-1', ws as any, makeWorkspace())
      const after = Date.now()

      const entry = mgr.getExtension('ext-1')!
      expect(entry.lastHeartbeat).toBeGreaterThanOrEqual(before)
      expect(entry.lastHeartbeat).toBeLessThanOrEqual(after)
    })
  })

  // ── Frontend CRUD ──────────────────────────────────────────────────

  describe('addFrontend / getFrontend / removeFrontend', () => {
    it('adds and retrieves a frontend', () => {
      const { ws } = createMockWs()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mgr.addFrontend('fe-1', ws as any)

      const entry = mgr.getFrontend('fe-1')
      expect(entry).toBeDefined()
      expect(entry?.selectedExtensionId).toBeNull()
    })

    it('returns undefined for an unknown frontend', () => {
      expect(mgr.getFrontend('ghost')).toBeUndefined()
    })

    it('removes a frontend', () => {
      const { ws } = createMockWs()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mgr.addFrontend('fe-1', ws as any)
      mgr.removeFrontend('fe-1')
      expect(mgr.getFrontend('fe-1')).toBeUndefined()
    })

    it('removeFrontend is a no-op for unknown id', () => {
      expect(() => mgr.removeFrontend('ghost')).not.toThrow()
    })
  })

  // ── selectWorkspace ────────────────────────────────────────────────

  describe('selectWorkspace', () => {
    it('links a frontend to an extension', () => {
      const { ws } = createMockWs()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mgr.addFrontend('fe-1', ws as any)
      mgr.selectWorkspace('fe-1', 'ext-1')

      expect(mgr.getFrontend('fe-1')?.selectedExtensionId).toBe('ext-1')
    })

    it('can update selection to a different extension', () => {
      const { ws } = createMockWs()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mgr.addFrontend('fe-1', ws as any)
      mgr.selectWorkspace('fe-1', 'ext-1')
      mgr.selectWorkspace('fe-1', 'ext-2')

      expect(mgr.getFrontend('fe-1')?.selectedExtensionId).toBe('ext-2')
    })

    it('is a no-op if frontend does not exist', () => {
      expect(() => mgr.selectWorkspace('ghost', 'ext-1')).not.toThrow()
    })
  })

  // ── listWorkspaces ─────────────────────────────────────────────────

  describe('listWorkspaces', () => {
    it('returns empty array when no extensions are connected', () => {
      expect(mgr.listWorkspaces()).toEqual([])
    })

    it('returns correct shape for each connected extension', () => {
      const { ws } = createMockWs()
      const workspace = makeWorkspace({ extensionId: 'ext-1', name: 'Project Alpha', rootPath: '/alpha', gitBranch: 'dev' })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mgr.addExtension('ext-1', ws as any, workspace)

      const result = mgr.listWorkspaces()
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        extensionId: 'ext-1',
        displayName: 'Project Alpha',
        rootPath: '/alpha',
        gitBranch: 'dev',
        extensionVersion: '0.0.3',
        status: 'connected',
      })
    })

    it('returns multiple workspaces', () => {
      for (let i = 1; i <= 3; i++) {
        const { ws } = createMockWs()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mgr.addExtension(`ext-${i}`, ws as any, makeWorkspace({ extensionId: `ext-${i}`, name: `WS ${i}` }))
      }
      expect(mgr.listWorkspaces()).toHaveLength(3)
    })

    it('reflects stale status in the list', () => {
      const { ws } = createMockWs()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mgr.addExtension('ext-1', ws as any, makeWorkspace())

      // Manually mark stale
      const entry = mgr.getExtension('ext-1')!
      entry.status = 'stale'

      expect(mgr.listWorkspaces()[0].status).toBe('stale')
    })

    it('handles null gitBranch', () => {
      const { ws } = createMockWs()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mgr.addExtension('ext-1', ws as any, makeWorkspace({ gitBranch: null }))
      expect(mgr.listWorkspaces()[0].gitBranch).toBeNull()
    })
  })

  // ── getAdminWorkspaces ────────────────────────────────────────────

  describe('getAdminWorkspaces', () => {
    it('returns runtime metadata for connected extensions', () => {
      const { ws } = createMockWs()
      const connectedAtBefore = Date.now()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mgr.addExtension('ext-1', ws as any, makeWorkspace({ name: 'Project Alpha', rootPath: '/alpha' }))
      const connectedAtAfter = Date.now()

      const result = mgr.getAdminWorkspaces()
      expect(result).toHaveLength(1)
      expect(result[0]).toMatchObject({
        extensionId: 'ext-1',
        displayName: 'Project Alpha',
        rootPath: '/alpha',
        gitBranch: 'main',
        vscodeVersion: '1.85.0',
        extensionVersion: '0.0.3',
        status: 'connected',
      })
      expect(result[0].connectedAt).toBeGreaterThanOrEqual(connectedAtBefore)
      expect(result[0].connectedAt).toBeLessThanOrEqual(connectedAtAfter)
      expect(result[0].lastHeartbeat).toBeGreaterThanOrEqual(result[0].connectedAt)
    })

    it('reflects stale status and updated heartbeat', () => {
      const { ws } = createMockWs()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mgr.addExtension('ext-1', ws as any, makeWorkspace())
      const entry = mgr.getExtension('ext-1')!
      entry.status = 'stale'
      entry.lastHeartbeat = 12345

      const result = mgr.getAdminWorkspaces()
      expect(result[0].status).toBe('stale')
      expect(result[0].lastHeartbeat).toBe(12345)
    })
  })

  // ── getFrontendsForExtension ───────────────────────────────────────

  describe('getFrontendsForExtension', () => {
    it('returns empty array when no frontends are watching the extension', () => {
      expect(mgr.getFrontendsForExtension('ext-1')).toEqual([])
    })

    it('returns only the frontends that selected the given extension', () => {
      const { ws: ws1 } = createMockWs()
      const { ws: ws2 } = createMockWs()
      const { ws: ws3 } = createMockWs()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mgr.addFrontend('fe-1', ws1 as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mgr.addFrontend('fe-2', ws2 as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mgr.addFrontend('fe-3', ws3 as any)

      mgr.selectWorkspace('fe-1', 'ext-1')
      mgr.selectWorkspace('fe-2', 'ext-2')
      mgr.selectWorkspace('fe-3', 'ext-1')

      const result = mgr.getFrontendsForExtension('ext-1')
      expect(result).toHaveLength(2)
    })

    it('excludes frontends with no workspace selected', () => {
      const { ws } = createMockWs()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mgr.addFrontend('fe-unselected', ws as any)

      expect(mgr.getFrontendsForExtension('ext-1')).toHaveLength(0)
    })
  })

  // ── removeExtension cleanup ────────────────────────────────────────

  describe('removeExtension cleanup', () => {
    it('extension is no longer in listWorkspaces after removal', () => {
      const { ws } = createMockWs()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mgr.addExtension('ext-1', ws as any, makeWorkspace())
      mgr.removeExtension('ext-1')

      expect(mgr.listWorkspaces()).toHaveLength(0)
    })

    it('getFrontendsForExtension still works after extension is removed', () => {
      const { ws: extWs } = createMockWs()
      const { ws: feWs } = createMockWs()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mgr.addExtension('ext-1', extWs as any, makeWorkspace())
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mgr.addFrontend('fe-1', feWs as any)
      mgr.selectWorkspace('fe-1', 'ext-1')

      mgr.removeExtension('ext-1')

      // Frontend still has selectedExtensionId set — the mapping is not auto-cleared
      // (cleanup is the caller's responsibility in onClose)
      const frontends = mgr.getFrontendsForExtension('ext-1')
      expect(frontends).toHaveLength(1) // frontend still refers to the removed extension
    })
  })

  // ── updateHeartbeat ────────────────────────────────────────────────

  describe('updateHeartbeat', () => {
    it('resets a stale extension back to connected', () => {
      const { ws } = createMockWs()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mgr.addExtension('ext-1', ws as any, makeWorkspace())

      const entry = mgr.getExtension('ext-1')!
      entry.status = 'stale'
      entry.staleAt = Date.now() - 10000

      mgr.updateHeartbeat('ext-1')

      expect(entry.status).toBe('connected')
      expect(entry.staleAt).toBeNull()
    })

    it('is a no-op for unknown extension', () => {
      expect(() => mgr.updateHeartbeat('ghost')).not.toThrow()
    })
  })

  // ── heartbeat stale detection ──────────────────────────────────────

  describe('heartbeat stale detection (fake timers)', () => {
    it('marks extension stale after 40s without a heartbeat', () => {
      const { ws } = createMockWs()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mgr.addExtension('ext-1', ws as any, makeWorkspace())
      mgr.startHeartbeat()

      // Advance 31s — heartbeat fires once; 40s since lastHeartbeat not yet reached
      vi.advanceTimersByTime(31000)
      expect(mgr.getExtension('ext-1')?.status).toBe('connected')

      // Advance another 30s — now 61s since lastHeartbeat; next interval fires
      vi.advanceTimersByTime(30000)
      expect(mgr.getExtension('ext-1')?.status).toBe('stale')
    })

    it('removes extension after 5min stale', () => {
      const { ws } = createMockWs()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mgr.addExtension('ext-1', ws as any, makeWorkspace())
      mgr.startHeartbeat()

      // Make it stale first: advance 61s
      vi.advanceTimersByTime(61000)
      expect(mgr.getExtension('ext-1')?.status).toBe('stale')

      // Now advance 5 min + 1 interval tick (30s) so the interval can detect staleElapsed > 5min
      vi.advanceTimersByTime(5 * 60 * 1000 + 30000)
      expect(mgr.getExtension('ext-1')).toBeUndefined()
    })

    it('does not start multiple heartbeat intervals', () => {
      mgr.startHeartbeat()
      mgr.startHeartbeat()
      // If a second interval were started we would get double ticks — we just verify no error
      mgr.stopHeartbeat()
    })

    it('stopHeartbeat prevents further stale marking', () => {
      const { ws } = createMockWs()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mgr.addExtension('ext-1', ws as any, makeWorkspace())
      mgr.startHeartbeat()
      mgr.stopHeartbeat()

      vi.advanceTimersByTime(5 * 60 * 1000)
      // Interval was cleared, so extension should still be 'connected'
      expect(mgr.getExtension('ext-1')?.status).toBe('connected')
    })
  })
})
