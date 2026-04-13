import { describe, expect, it } from 'vitest'
import { decodeBase64ToBytes, formatPreviewSize } from '../services/file-preview'

describe('decodeBase64ToBytes', () => {
  it('decodes base64 content to raw bytes', () => {
    expect([...decodeBase64ToBytes('SGk=')]).toEqual([72, 105])
  })
})

describe('formatPreviewSize', () => {
  it('formats bytes into readable labels', () => {
    expect(formatPreviewSize(512)).toBe('512 B')
    expect(formatPreviewSize(1536)).toBe('1.5 KB')
    expect(formatPreviewSize(2 * 1024 * 1024)).toBe('2.0 MB')
  })
})
