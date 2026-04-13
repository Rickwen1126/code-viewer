import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isRestorableLocation,
  readLastLocationForWorkspace,
  writeLastLocationForWorkspace,
} from '../services/last-location'
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

describe('last-location storage', () => {
  const workspace: Workspace = {
    extensionId: 'ext-123',
    workspaceKey: 'ws_abc',
    name: 'code-viewer',
    rootPath: '/repo/code-viewer',
    gitBranch: 'main',
    vscodeVersion: '1.115.0',
    extensionVersion: '0.0.5',
  }

  beforeEach(() => {
    storage.clear()
  })

  it('accepts only restorable canonical detail routes', () => {
    expect(isRestorableLocation('/files/src/app.tsx')).toBe(true)
    expect(isRestorableLocation('/git/diff/src/app.tsx')).toBe(true)
    expect(isRestorableLocation('/tours/abc?step=2')).toBe(false)
    expect(isRestorableLocation('/tours/abc')).toBe(true)
    expect(isRestorableLocation('/files')).toBe(false)
    expect(isRestorableLocation('/open/file')).toBe(false)
  })

  it('writes and reads a last location for the matching workspace', () => {
    writeLastLocationForWorkspace(workspace, '/files/src/app.tsx?line=42')

    expect(readLastLocationForWorkspace(workspace)).toBe('/files/src/app.tsx?line=42')
  })

  it('ignores non-restorable routes', () => {
    writeLastLocationForWorkspace(workspace, '/workspaces')

    expect(readLastLocationForWorkspace(workspace)).toBeNull()
  })

  it('uses stable workspace identity before runtime extensionId', () => {
    writeLastLocationForWorkspace(workspace, '/tours/tour-1?step=2')

    const liveWorkspace = { ...workspace, extensionId: 'ext-new' }
    expect(readLastLocationForWorkspace(liveWorkspace)).toBe('/tours/tour-1?step=2')
  })

  it('does not reuse a snapshot from another workspace', () => {
    writeLastLocationForWorkspace(workspace, '/git/diff/src/app.tsx?status=modified')

    expect(
      readLastLocationForWorkspace({ ...workspace, workspaceKey: 'ws_other', rootPath: '/repo/other' }),
    ).toBeNull()
  })
})
