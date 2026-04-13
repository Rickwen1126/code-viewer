import { describe, expect, it } from 'vitest'
import {
  buildAddedFileHunks,
  shouldLoadAddedFileTextFallback,
  shouldLoadGitMediaPreview,
} from '../pages/git/diff-detail-utils'

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

describe('git diff media-aware helpers', () => {
  it('loads media preview for current-worktree media files without text hunks', () => {
    expect(shouldLoadGitMediaPreview({
      previewKind: 'image',
      status: 'modified',
      hasDiffHunks: false,
    })).toBe(true)
  })

  it('does not load media preview for deleted or commit-scoped diffs', () => {
    expect(shouldLoadGitMediaPreview({
      previewKind: 'video',
      status: 'deleted',
      hasDiffHunks: false,
    })).toBe(false)

    expect(shouldLoadGitMediaPreview({
      previewKind: 'video',
      status: 'modified',
      commit: 'abc123',
      hasDiffHunks: false,
    })).toBe(false)
  })

  it('falls back to synthetic added-file hunks only for non-media added files', () => {
    expect(shouldLoadAddedFileTextFallback({
      previewKind: null,
      status: 'added',
      hasDiffHunks: false,
    })).toBe(true)

    expect(shouldLoadAddedFileTextFallback({
      previewKind: 'image',
      status: 'added',
      hasDiffHunks: false,
    })).toBe(false)
  })
})
