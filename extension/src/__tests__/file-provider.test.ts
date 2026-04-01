import { describe, it, expect, vi } from 'vitest'

vi.mock('vscode', () => ({
  workspace: {},
  Uri: {},
  FileType: {
    File: 1,
    Directory: 2,
  },
}))

import { shouldSkipDirectory } from '../providers/file-provider'

describe('shouldSkipDirectory', () => {
  it('skips known noisy or generated directories', () => {
    expect(shouldSkipDirectory('.git')).toBe(true)
    expect(shouldSkipDirectory('node_modules')).toBe(true)
    expect(shouldSkipDirectory('.next')).toBe(true)
    expect(shouldSkipDirectory('dist')).toBe(true)
  })

  it('keeps useful dot-directories visible in the file tree', () => {
    expect(shouldSkipDirectory('.claude')).toBe(false)
    expect(shouldSkipDirectory('.agents')).toBe(false)
    expect(shouldSkipDirectory('.vscode')).toBe(false)
    expect(shouldSkipDirectory('.progress')).toBe(false)
  })
})
