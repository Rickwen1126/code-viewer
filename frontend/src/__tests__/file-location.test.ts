import { describe, expect, it } from 'vitest'
import {
  buildFileLocationUrl,
  buildFileRoutePath,
  oneBasedToZeroBasedLine,
  parseFileLocationQuery,
  zeroBasedToOneBasedLine,
} from '../services/file-location'

describe('file-location helpers', () => {
  it('builds canonical file route paths with per-segment encoding', () => {
    expect(buildFileRoutePath('src/foo bar.ts')).toBe('/files/src/foo%20bar.ts')
  })

  it('builds file location URLs with 1-based line query params', () => {
    expect(buildFileLocationUrl('src/foo.ts', { line: 12, endLine: 16 })).toBe(
      '/files/src/foo.ts?line=12&endLine=16',
    )
  })

  it('omits invalid line params from the canonical URL', () => {
    expect(buildFileLocationUrl('src/foo.ts', { line: 0, endLine: 3 })).toBe('/files/src/foo.ts')
    expect(buildFileLocationUrl('src/foo.ts', { line: 8, endLine: 3 })).toBe('/files/src/foo.ts?line=8')
  })

  it('parses valid location queries and drops invalid ranges', () => {
    expect(parseFileLocationQuery(new URLSearchParams('line=12&endLine=16'))).toEqual({
      line: 12,
      endLine: 16,
    })
    expect(parseFileLocationQuery(new URLSearchParams('line=12&endLine=8'))).toEqual({
      line: 12,
    })
    expect(parseFileLocationQuery(new URLSearchParams('line=0'))).toEqual({})
  })

  it('converts between 0-based editor lines and 1-based URL lines', () => {
    expect(zeroBasedToOneBasedLine(0)).toBe(1)
    expect(zeroBasedToOneBasedLine(41)).toBe(42)
    expect(oneBasedToZeroBasedLine(1)).toBe(0)
    expect(oneBasedToZeroBasedLine(42)).toBe(41)
    expect(oneBasedToZeroBasedLine(0)).toBeNull()
  })
})
