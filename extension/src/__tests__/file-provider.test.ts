import { describe, it, expect, vi } from 'vitest'

vi.mock('vscode', () => ({
  workspace: {},
  Uri: {},
  FileType: {
    File: 1,
    Directory: 2,
  },
}))

import { shouldSkipDirectory, escapeGlobPattern } from '../providers/file-provider'

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

describe('escapeGlobPattern', () => {
  it('escapes glob metacharacters so a file path stays file-scoped', () => {
    expect(escapeGlobPattern('src/foo[bar]*?.ts')).toBe('src/foo\\[bar\\]\\*\\?.ts')
  })

  it('keeps ordinary relative paths unchanged', () => {
    expect(escapeGlobPattern('src/index.ts')).toBe('src/index.ts')
  })
})
