import { describe, expect, it } from 'vitest'
import {
  buildFileLinkResponse,
  buildGitDiffLinkResponse,
  buildTourStepLinkResponse,
  getLanIp,
  normalizeNonEmptyString,
  parseGitDiffStatus,
  normalizeRepoRelativePath,
  parsePositiveInt,
  type WorkspaceLinkEntry,
} from '../http/file-links.js'

function makeWorkspace(overrides: Partial<WorkspaceLinkEntry> = {}): WorkspaceLinkEntry {
  return {
    extensionId: 'ext-1',
    workspaceKey: 'ws_codeviewer',
    displayName: 'Code Viewer',
    rootPath: '/Users/rickwen/code/code-viewer',
    gitBranch: 'main',
    extensionVersion: '0.0.3',
    status: 'connected',
    ...overrides,
  }
}

describe('normalizeRepoRelativePath', () => {
  it('normalizes safe relative repo paths', () => {
    expect(normalizeRepoRelativePath('frontend/./src/app.tsx')).toBe('frontend/src/app.tsx')
    expect(normalizeRepoRelativePath('frontend\\src\\app.tsx')).toBe('frontend/src/app.tsx')
  })

  it('rejects absolute or escaping paths', () => {
    expect(normalizeRepoRelativePath('/etc/passwd')).toBeNull()
    expect(normalizeRepoRelativePath('../secrets.txt')).toBeNull()
    expect(normalizeRepoRelativePath('frontend/../../secrets.txt')).toBeNull()
  })
})

describe('parsePositiveInt', () => {
  it('only accepts positive integers', () => {
    expect(parsePositiveInt('12')).toBe(12)
    expect(parsePositiveInt('0')).toBeUndefined()
    expect(parsePositiveInt('-1')).toBeUndefined()
    expect(parsePositiveInt('abc')).toBeUndefined()
  })
})

describe('parseGitDiffStatus', () => {
  it('only accepts known git statuses', () => {
    expect(parseGitDiffStatus('added')).toBe('added')
    expect(parseGitDiffStatus('modified')).toBe('modified')
    expect(parseGitDiffStatus('deleted')).toBe('deleted')
    expect(parseGitDiffStatus('renamed')).toBe('renamed')
    expect(parseGitDiffStatus('weird')).toBeUndefined()
  })
})

describe('normalizeNonEmptyString', () => {
  it('returns trimmed non-empty strings only', () => {
    expect(normalizeNonEmptyString('  tour-abc  ')).toBe('tour-abc')
    expect(normalizeNonEmptyString('   ')).toBeNull()
    expect(normalizeNonEmptyString(null)).toBeNull()
  })
})

describe('buildFileLinkResponse', () => {
  it('builds local and lan deep links for a connected workspace', () => {
    const result = buildFileLinkResponse(
      {
        workspaceRef: 'ws_codeviewer',
        path: 'frontend/src/app.tsx',
        line: 12,
        endLine: 20,
      },
      [makeWorkspace()],
      { lanIp: '192.168.1.23' },
    )

    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return

    expect(result.payload.workspace.workspaceKey).toBe('ws_codeviewer')
    expect(result.payload.resolverPath).toBe(
      '/open/file?workspace=ws_codeviewer&path=frontend%2Fsrc%2Fapp.tsx&line=12&endLine=20',
    )
    expect(result.payload.localUrl).toBe(
      'http://localhost:4801/open/file?workspace=ws_codeviewer&path=frontend%2Fsrc%2Fapp.tsx&line=12&endLine=20',
    )
    expect(result.payload.lanUrl).toBe(
      'http://192.168.1.23:4801/open/file?workspace=ws_codeviewer&path=frontend%2Fsrc%2Fapp.tsx&line=12&endLine=20',
    )
  })

  it('accepts legacy root-path references during migration', () => {
    const result = buildFileLinkResponse(
      {
        workspaceRef: '/Users/rickwen/code/code-viewer',
        path: 'frontend/src/app.tsx',
        line: 12,
      },
      [makeWorkspace()],
    )

    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return

    expect(result.payload.resolverPath).toBe(
      '/open/file?workspace=ws_codeviewer&path=frontend%2Fsrc%2Fapp.tsx&line=12',
    )
  })

  it('reports missing or stale workspaces separately', () => {
    expect(
      buildFileLinkResponse(
        { workspaceRef: '/missing', path: 'frontend/src/app.tsx' },
        [makeWorkspace()],
      ).kind,
    ).toBe('workspace_not_found')

    expect(
      buildFileLinkResponse(
        { workspaceRef: 'ws_codeviewer', path: 'frontend/src/app.tsx' },
        [makeWorkspace({ status: 'stale' })],
      ).kind,
    ).toBe('workspace_not_connected')
  })
})

describe('buildGitDiffLinkResponse', () => {
  it('builds deep links for a connected git diff workspace', () => {
    const result = buildGitDiffLinkResponse(
      {
        workspaceRef: 'ws_codeviewer',
        path: 'packages/cli/src/index.ts',
        commit: 'abc123',
        status: 'modified',
      },
      [makeWorkspace()],
      { lanIp: '192.168.1.23' },
    )

    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return

    expect(result.payload.resolverPath).toBe(
      '/open/git-diff?workspace=ws_codeviewer&path=packages%2Fcli%2Fsrc%2Findex.ts&commit=abc123&status=modified',
    )
    expect(result.payload.localUrl).toBe(
      'http://localhost:4801/open/git-diff?workspace=ws_codeviewer&path=packages%2Fcli%2Fsrc%2Findex.ts&commit=abc123&status=modified',
    )
    expect(result.payload.lanUrl).toBe(
      'http://192.168.1.23:4801/open/git-diff?workspace=ws_codeviewer&path=packages%2Fcli%2Fsrc%2Findex.ts&commit=abc123&status=modified',
    )
  })
})

describe('buildTourStepLinkResponse', () => {
  it('builds deep links for a connected tour step workspace', () => {
    const result = buildTourStepLinkResponse(
      {
        workspaceRef: 'ws_codeviewer',
        tourId: 'review-tour',
        step: 3,
      },
      [makeWorkspace()],
      { lanIp: '192.168.1.23' },
    )

    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return

    expect(result.payload.resolverPath).toBe(
      '/open/tour?workspace=ws_codeviewer&tourId=review-tour&step=3',
    )
    expect(result.payload.localUrl).toBe(
      'http://localhost:4801/open/tour?workspace=ws_codeviewer&tourId=review-tour&step=3',
    )
    expect(result.payload.lanUrl).toBe(
      'http://192.168.1.23:4801/open/tour?workspace=ws_codeviewer&tourId=review-tour&step=3',
    )
  })
})

describe('getLanIp', () => {
  it('returns either a LAN ip or null', () => {
    const value = getLanIp()
    expect(value === null || /^\d{1,3}(\.\d{1,3}){3}$/.test(value)).toBe(true)
  })
})
