import { describe, expect, it } from 'vitest'
import { buildAddedFileHunks } from '../pages/git/diff-detail-utils'

describe('buildAddedFileHunks', () => {
  it('creates a synthetic added-file hunk from file content', () => {
    const hunks = buildAddedFileHunks('line1\nline2')

    expect(hunks).toHaveLength(1)
    expect(hunks[0]).toMatchObject({
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: 2,
    })
    expect(hunks[0].changes).toEqual([
      { type: 'add', content: 'line1', newLineNumber: 1 },
      { type: 'add', content: 'line2', newLineNumber: 2 },
    ])
  })

  it('returns no hunks for an empty new file', () => {
    expect(buildAddedFileHunks('')).toEqual([])
  })
})
