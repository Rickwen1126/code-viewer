import { describe, expect, it, vi } from 'vitest'

vi.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [],
    fs: {},
    getConfiguration: () => ({
      get: (_key: string, fallback: unknown) => fallback,
    }),
  },
  Uri: {
    file: (fsPath: string) => ({ fsPath }),
  },
  FileType: {
    File: 1,
    Directory: 2,
  },
}))

import { annotationPathFor, validateAnnotationPath } from '../providers/annotation-provider'

const workspaceFolder = {
  uri: { fsPath: '/Users/rickwen/code/example' },
  name: 'example',
  index: 0,
} as any

describe('annotation provider path helpers', () => {
  it('derives the V1 annotation artifact path', () => {
    expect(annotationPathFor('src/providers/file-provider.ts')).toBe(
      '.codeviewer/annotated/src/providers/file-provider.ts',
    )
  })

  it('normalizes dot slash and backslashes', () => {
    const result = validateAnnotationPath('./src\\index.ts', workspaceFolder)
    expect(result.relativePath).toBe('src/index.ts')
    expect(result.annotationPath).toBe('.codeviewer/annotated/src/index.ts')
    expect(result.sourceUri.fsPath).toBe('/Users/rickwen/code/example/src/index.ts')
  })

  it('rejects absolute paths', () => {
    expect(() => validateAnnotationPath('/etc/passwd', workspaceFolder)).toThrow(/workspace-relative/)
  })

  it('rejects traversal paths', () => {
    expect(() => validateAnnotationPath('../outside.ts', workspaceFolder)).toThrow(/escape/)
    expect(() => validateAnnotationPath('src/../outside.ts', workspaceFolder)).toThrow(/escape/)
  })
})
