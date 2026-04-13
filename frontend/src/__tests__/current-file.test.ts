import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getLegacyWorkspaceCurrentFileKey,
  getWorkspaceCurrentFileKey,
  readCurrentFileForWorkspace,
  writeCurrentFileForWorkspace,
} from '../services/current-file'

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

describe('current-file storage', () => {
  const workspace = {
    workspaceKey: 'ws_abc',
    extensionId: 'ext-123',
  }

  beforeEach(() => {
    storage.clear()
  })

  it('builds stable and legacy workspace keys', () => {
    expect(getWorkspaceCurrentFileKey(workspace)).toBe('code-viewer:current-file:ws_abc')
    expect(getLegacyWorkspaceCurrentFileKey(workspace)).toBe('code-viewer:current-file:ext-123')
  })

  it('writes only the stable workspace-scoped key', () => {
    writeCurrentFileForWorkspace(workspace, 'src/app.tsx')
    expect(storage.get('code-viewer:current-file:ws_abc')).toBe('src/app.tsx')
    expect(storage.has('code-viewer:current-file:ext-123')).toBe(false)
    expect(storage.has('code-viewer:current-file')).toBe(false)
  })

  it('reads stable workspace-scoped key first', () => {
    storage.set('code-viewer:current-file:ws_abc', 'src/stable.tsx')
    storage.set('code-viewer:current-file:ext-123', 'src/legacy.tsx')
    storage.set('code-viewer:current-file', 'src/global.tsx')
    expect(readCurrentFileForWorkspace(workspace)).toBe('src/stable.tsx')
  })

  it('falls back to legacy workspace key then global key for migration', () => {
    storage.set('code-viewer:current-file:ext-123', 'src/legacy.tsx')
    expect(readCurrentFileForWorkspace(workspace)).toBe('src/legacy.tsx')

    storage.clear()
    storage.set('code-viewer:current-file', 'src/global.tsx')
    expect(readCurrentFileForWorkspace(workspace)).toBe('src/global.tsx')
  })

  it('returns null when no current file exists', () => {
    expect(readCurrentFileForWorkspace(workspace)).toBeNull()
  })
})
