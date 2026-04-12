import { describe, expect, it } from 'vitest'
import { buildOpenFileUrl } from '../links.js'

describe('buildOpenFileUrl', () => {
  it('builds stable resolver URLs with workspace root path', () => {
    expect(buildOpenFileUrl('/Users/rickwen/code/code-viewer', 'src/app.tsx', { line: 12, endLine: 20 })).toBe(
      '/open/file?workspace=%2FUsers%2Frickwen%2Fcode%2Fcode-viewer&path=src%2Fapp.tsx&line=12&endLine=20',
    )
  })

  it('drops invalid or reversed line ranges', () => {
    expect(buildOpenFileUrl('/repo', 'src/app.tsx', { line: 0, endLine: 3 })).toBe(
      '/open/file?workspace=%2Frepo&path=src%2Fapp.tsx',
    )
    expect(buildOpenFileUrl('/repo', 'src/app.tsx', { line: 12, endLine: 4 })).toBe(
      '/open/file?workspace=%2Frepo&path=src%2Fapp.tsx&line=12',
    )
  })
})
