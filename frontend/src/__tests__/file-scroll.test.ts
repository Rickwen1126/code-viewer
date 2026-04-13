import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getLegacyWorkspaceFileScrollKey,
  getWorkspaceFileScrollKey,
  readSavedFileScroll,
  writeSavedFileScroll,
  type FileScrollSnapshot,
} from '../services/file-scroll'
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

describe('file-scroll storage', () => {
  const workspace: Workspace = {
    extensionId: 'ext-123',
    workspaceKey: 'ws_abc',
    name: 'code-viewer',
    rootPath: '/repo/code-viewer',
    gitBranch: 'main',
    vscodeVersion: '1.115.0',
    extensionVersion: '0.0.5',
  }
  const path = 'src/app.tsx'
  const snapshot: FileScrollSnapshot = {
    scrollTop: 240,
    contentLength: 1024,
    timestamp: 123456789,
  }

  beforeEach(() => {
    storage.clear()
  })

  it('builds stable and legacy keys separately', () => {
    expect(getWorkspaceFileScrollKey(workspace, path)).toBe('code-viewer:scroll:ws_abc:src/app.tsx')
    expect(getLegacyWorkspaceFileScrollKey(workspace, path)).toBe('code-viewer:scroll:ext-123:src/app.tsx')
  })

  it('writes only the stable workspace key', () => {
    writeSavedFileScroll(workspace, path, snapshot)

    expect(storage.get('code-viewer:scroll:ws_abc:src/app.tsx')).toBe(JSON.stringify(snapshot))
    expect(storage.has('code-viewer:scroll:ext-123:src/app.tsx')).toBe(false)
  })

  it('reads the stable scroll snapshot first', () => {
    storage.set('code-viewer:scroll:ws_abc:src/app.tsx', JSON.stringify(snapshot))
    storage.set(
      'code-viewer:scroll:ext-123:src/app.tsx',
      JSON.stringify({ ...snapshot, scrollTop: 120 }),
    )

    expect(readSavedFileScroll(workspace, path)).toEqual(snapshot)
  })

  it('falls back to the legacy extension key during migration', () => {
    storage.set('code-viewer:scroll:ext-123:src/app.tsx', JSON.stringify(snapshot))

    expect(readSavedFileScroll(workspace, path)).toEqual(snapshot)
  })
})
