import { describe, expect, it } from 'vitest'
import { buildOpenFileUrl, buildOpenGitDiffUrl, buildOpenTourUrl } from '../links.js'

describe('buildOpenFileUrl', () => {
  it('builds stable resolver URLs with workspace keys', () => {
    expect(buildOpenFileUrl('ws_codeviewer', 'src/app.tsx', { line: 12, endLine: 20 })).toBe(
      '/open/file?workspace=ws_codeviewer&path=src%2Fapp.tsx&line=12&endLine=20',
    )
  })

  it('drops invalid or reversed line ranges', () => {
    expect(buildOpenFileUrl('ws_repo', 'src/app.tsx', { line: 0, endLine: 3 })).toBe(
      '/open/file?workspace=ws_repo&path=src%2Fapp.tsx',
    )
    expect(buildOpenFileUrl('ws_repo', 'src/app.tsx', { line: 12, endLine: 4 })).toBe(
      '/open/file?workspace=ws_repo&path=src%2Fapp.tsx&line=12',
    )
  })
})

describe('buildOpenTourUrl', () => {
  it('builds stable resolver URLs for tour steps', () => {
    expect(buildOpenTourUrl('ws_codeviewer', 'tour-abc', { step: 3 })).toBe(
      '/open/tour?workspace=ws_codeviewer&tourId=tour-abc&step=3',
    )
  })

  it('drops invalid step values', () => {
    expect(buildOpenTourUrl('ws_repo', 'tour-xyz', { step: 0 })).toBe(
      '/open/tour?workspace=ws_repo&tourId=tour-xyz',
    )
  })
})

describe('buildOpenGitDiffUrl', () => {
  it('builds stable resolver URLs for git diffs', () => {
    expect(buildOpenGitDiffUrl('ws_codeviewer', 'src/foo bar.ts', { commit: 'abc123', status: 'modified' })).toBe(
      '/open/git-diff?workspace=ws_codeviewer&path=src%2Ffoo+bar.ts&commit=abc123&status=modified',
    )
  })

  it('omits optional query params when absent', () => {
    expect(buildOpenGitDiffUrl('ws_repo', 'src/app.tsx')).toBe(
      '/open/git-diff?workspace=ws_repo&path=src%2Fapp.tsx',
    )
  })
})
