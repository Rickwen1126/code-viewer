import { describe, expect, it } from 'vitest'
import { buildGitDiffUrl, buildOpenFileUrl, buildTourStepUrl, parsePositiveIntQuery } from '../services/semantic-navigation'

describe('semantic-navigation helpers', () => {
  it('builds canonical tour step URLs', () => {
    expect(buildTourStepUrl('tour-abc', 3)).toBe('/tours/tour-abc?step=3')
  })

  it('builds canonical git diff URLs with encoded path and query', () => {
    expect(buildGitDiffUrl('src/foo bar.ts', { commit: 'abc123', status: 'modified' })).toBe(
      '/git/diff/src/foo%20bar.ts?commit=abc123&status=modified',
    )
  })

  it('builds external open-file resolver URLs with stable workspace ref', () => {
    expect(buildOpenFileUrl('/Users/rickwen/code/code-viewer', 'src/app.tsx', { line: 12, endLine: 20 })).toBe(
      '/open/file?workspace=%2FUsers%2Frickwen%2Fcode%2Fcode-viewer&path=src%2Fapp.tsx&line=12&endLine=20',
    )
  })

  it('parses positive integer query params only', () => {
    expect(parsePositiveIntQuery(new URLSearchParams('step=4'), 'step')).toBe(4)
    expect(parsePositiveIntQuery(new URLSearchParams('step=0'), 'step')).toBeNull()
    expect(parsePositiveIntQuery(new URLSearchParams('step=abc'), 'step')).toBeNull()
  })
})
