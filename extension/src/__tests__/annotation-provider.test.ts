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

import {
  annotationPathFor,
  validateAnnotationArtifactText,
  validateAnnotationPath,
} from '../providers/annotation-provider'

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

describe('annotation artifact validation', () => {
  it('accepts source-language annotation artifacts with source tail preserved', () => {
    const result = validateAnnotationArtifactText(
      'export function add(a: number, b: number) {\n  return a + b\n}\n',
      '// 說明 TypeScript function signature。\nexport function add(a: number, b: number) {\n  // return 會把兩個 number 相加。\n  return a + b\n}\n',
      'src/add.ts',
      { size: 128, updatedAt: 1234 },
    )

    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(result.sourceLineCount).toBe(4)
    expect(result.artifactLineCount).toBe(6)
  })

  it('rejects stale-looking markdown or truncated artifacts', () => {
    const result = validateAnnotationArtifactText(
      'def main():\n    return 0\n',
      '```python\n# only markdown\n```\n',
      'src/app.py',
    )

    expect(result.ok).toBe(false)
    expect(result.diagnostics).toContain('artifact contains Markdown fences')
    expect(result.diagnostics).toContain('artifact does not include the source tail')
  })
})
