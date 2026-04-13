import { beforeEach, describe, expect, it, vi } from 'vitest'
import { findMatchingWorkspace, isSameWorkspace, readStoredWorkspace, writeStoredWorkspace } from '../services/selected-workspace'
import type { Workspace } from '@code-viewer/shared'

const storage = new Map<string, string>()

vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storage.set(key, value)
  },
  removeItem: (key: string) => {
    storage.delete(key)
  },
})

describe('selected-workspace', () => {
  const storedWorkspace: Workspace = {
    extensionId: 'ext-old',
    workspaceKey: 'ws_123',
    name: 'code-viewer',
    rootPath: '/repo/code-viewer',
    gitBranch: 'main',
    vscodeVersion: '1.115.0',
    extensionVersion: '0.0.5',
  }

  beforeEach(() => {
    storage.clear()
  })

  it('round-trips stored workspace snapshots', () => {
    writeStoredWorkspace(storedWorkspace)
    expect(readStoredWorkspace()).toEqual(storedWorkspace)
  })

  it('finds a live workspace by stable workspaceKey before stale extensionId', () => {
    const liveWorkspaces: Workspace[] = [
      { ...storedWorkspace, extensionId: 'ext-new', gitBranch: 'feature/123' },
    ]

    expect(findMatchingWorkspace(storedWorkspace, liveWorkspaces)).toEqual(liveWorkspaces[0])
  })

  it('falls back to rootPath when workspaceKey is missing or changed', () => {
    const legacyStored = { ...storedWorkspace, workspaceKey: '', extensionId: 'ext-old' }
    const liveWorkspaces: Workspace[] = [
      { ...storedWorkspace, extensionId: 'ext-new' },
    ]

    expect(findMatchingWorkspace(legacyStored, liveWorkspaces)).toEqual(liveWorkspaces[0])
  })

  it('falls back to extensionId only as the final migration path', () => {
    const legacyStored = { ...storedWorkspace, workspaceKey: '', rootPath: '' }
    const liveWorkspaces: Workspace[] = [
      { ...storedWorkspace, workspaceKey: 'ws_other', rootPath: '/repo/other' },
    ]

    expect(findMatchingWorkspace(legacyStored, liveWorkspaces)).toEqual(liveWorkspaces[0])
  })

  it('compares same-workspace checks by workspaceKey before runtime id', () => {
    const staleWorkspace = { ...storedWorkspace, extensionId: 'ext-old' }
    const liveWorkspace = { ...storedWorkspace, extensionId: 'ext-new' }

    expect(isSameWorkspace(staleWorkspace, liveWorkspace)).toBe(true)
  })
})
