import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as path from 'path'

// --- vscode mock ---
const mockTextDocuments: Array<{ uri: { fsPath: string } }> = []

vi.mock('vscode', () => ({
  Uri: {
    file: vi.fn((p: string) => ({ fsPath: p })),
  },
  workspace: {
    get textDocuments() {
      return mockTextDocuments
    },
  },
}))

import { validatePath } from '../utils/validate-path'

function makeWorkspaceFolder(fsPath: string) {
  return {
    uri: { fsPath },
    name: 'workspace',
    index: 0,
  } as import('vscode').WorkspaceFolder
}

describe('validatePath', () => {
  const workspaceRoot = '/home/user/project'
  const workspaceFolder = makeWorkspaceFolder(workspaceRoot)

  beforeEach(() => {
    mockTextDocuments.length = 0
  })

  it('accepts a path within the workspace', () => {
    const result = validatePath('src/index.ts', workspaceFolder)
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.uri.fsPath).toBe(path.resolve(workspaceRoot, 'src/index.ts'))
    }
  })

  it('accepts a nested path within the workspace', () => {
    const result = validatePath('a/b/c/deep.ts', workspaceFolder)
    expect(result.valid).toBe(true)
  })

  it('accepts the workspace root itself (empty-string resolves to root)', () => {
    const result = validatePath('', workspaceFolder)
    // path.resolve('/home/user/project', '') === '/home/user/project' which equals rootFsPath
    expect(result.valid).toBe(true)
  })

  it('blocks a path with ../ that escapes the workspace', () => {
    const result = validatePath('../../.ssh/id_rsa', workspaceFolder)
    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.reason).toBe('Path outside workspace')
    }
  })

  it('blocks an absolute path outside the workspace', () => {
    const result = validatePath('/etc/passwd', workspaceFolder)
    expect(result.valid).toBe(false)
  })

  it('blocks a sibling directory traversal', () => {
    // Resolves to /home/user/other — starts with the workspace root string but is actually outside
    const result = validatePath('../other/file.ts', workspaceFolder)
    expect(result.valid).toBe(false)
  })

  it('accepts a path to an open document outside the workspace (Go to Definition case)', () => {
    const outsidePath = '/home/user/node_modules/lib/index.ts'
    mockTextDocuments.push({ uri: { fsPath: outsidePath } })

    const result = validatePath(outsidePath, workspaceFolder)
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.uri.fsPath).toBe(outsidePath)
    }
  })

  it('rejects a path outside workspace when it is NOT an open document', () => {
    const outsidePath = '/home/user/node_modules/lib/index.ts'
    // No matching open document
    const result = validatePath(outsidePath, workspaceFolder)
    expect(result.valid).toBe(false)
  })
})

describe('tourId validation regex', () => {
  const validTourIds = ['my-tour', 'tour1', 'tour_name', 'MyTour', 'tour-123', 'TOUR']
  const invalidTourIds = ['../bad', '../../etc/passwd', 'tour/bad', 'tour.bad', 'tour bad', 'tour<bad>', '']

  for (const id of validTourIds) {
    it(`accepts valid tourId: "${id}"`, () => {
      expect(/^[\w\-]+$/.test(id)).toBe(true)
    })
  }

  for (const id of invalidTourIds) {
    it(`rejects invalid tourId: "${id}"`, () => {
      expect(/^[\w\-]+$/.test(id)).toBe(false)
    })
  }
})
