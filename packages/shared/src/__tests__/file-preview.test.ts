import { describe, expect, it } from 'vitest'
import { getFilePreviewKind, getFilePreviewMimeType } from '../file-preview.js'

describe('getFilePreviewKind', () => {
  it('recognizes supported image extensions', () => {
    expect(getFilePreviewKind('assets/photo.PNG')).toBe('image')
    expect(getFilePreviewKind('assets/icon.svg')).toBe('image')
  })

  it('recognizes supported video extensions', () => {
    expect(getFilePreviewKind('videos/demo.mp4')).toBe('video')
    expect(getFilePreviewKind('videos/clip.WEBM')).toBe('video')
  })

  it('returns null for non-previewable files', () => {
    expect(getFilePreviewKind('src/app.tsx')).toBeNull()
    expect(getFilePreviewKind('README')).toBeNull()
  })
})

describe('getFilePreviewMimeType', () => {
  it('returns the canonical mime type for supported files', () => {
    expect(getFilePreviewMimeType('assets/photo.jpeg')).toBe('image/jpeg')
    expect(getFilePreviewMimeType('videos/demo.mov')).toBe('video/quicktime')
  })

  it('returns null for unsupported files', () => {
    expect(getFilePreviewMimeType('src/app.tsx')).toBeNull()
  })
})
