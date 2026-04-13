import { describe, expect, it } from 'vitest'
import { buildOpenFileUrl } from '../links.js'

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
