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
  annotationRunLogPathFor,
  matchStopDeliveryForJob,
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

  it('derives a safe run log path from generation id', () => {
    expect(annotationRunLogPathFor('annotation-123')).toBe(
      '.codeviewer/annotation-runs/annotation-123/run.jsonl',
    )
    expect(annotationRunLogPathFor('../bad/id')).toBe(
      '.codeviewer/annotation-runs/.._bad_id/run.jsonl',
    )
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

  it('allows comments to mention newline protocol strings when source tail is preserved', () => {
    const result = validateAnnotationArtifactText(
      'stream.write(`${payload}\\n`)\n',
      '// 這裡說明 JSON-RPC 使用 \\n 作為 message framing delimiter。\nstream.write(`${payload}\\n`)\n',
      'src/gateway.ts',
    )

    expect(result.ok).toBe(true)
    expect(result.diagnostics).toEqual([])
  })

  it('rejects TypeScript artifacts that are too sparse after copying the source', () => {
    const source = Array.from({ length: 30 }, (_, index) => `export const value${index} = ${index}`).join('\n') + '\n'
    const artifact = [
      '// 只在檔頭多放一條註解，密度遠低於 annotation contract。',
      source.trimEnd(),
      '',
    ].join('\n')

    const result = validateAnnotationArtifactText(source, artifact, 'src/sparse.ts')

    expect(result.ok).toBe(false)
    expect(result.diagnostics).toContain(
      'annotation density below required threshold: added 1 comment lines, require 4',
    )
  })
})

describe('annotation stophook matching', () => {
  it('accepts a stop delivery only when binding id and created_at match the active job', () => {
    const result = matchStopDeliveryForJob(
      {
        submittedAt: Date.parse('2026-06-06T10:00:00Z'),
        target: { bindingId: 'binding-1', acquired: 'reused' },
      },
      {
        eventType: 'agent.lifecycle.stop',
        createdAt: '2026-06-06T10:00:05Z',
        source: {
          provider_id: 'codex',
          tool_name: 'codex',
          binding_id: 'binding-1',
        },
      },
    )

    expect(result).toEqual({ matches: true })
  })

  it('ignores stop deliveries from another binding or an older turn', () => {
    const bindingMismatch = matchStopDeliveryForJob(
      {
        submittedAt: Date.parse('2026-06-06T10:00:00Z'),
        target: { bindingId: 'binding-1', acquired: 'reused' },
      },
      {
        eventType: 'agent.lifecycle.stop',
        createdAt: '2026-06-06T10:00:05Z',
        source: { binding_id: 'binding-2' },
      },
    )
    const staleStop = matchStopDeliveryForJob(
      {
        submittedAt: Date.parse('2026-06-06T10:00:00Z'),
        target: { bindingId: 'binding-1', acquired: 'reused' },
      },
      {
        eventType: 'agent.lifecycle.stop',
        createdAt: '2026-06-06T09:59:59Z',
        source: { binding_id: 'binding-1' },
      },
    )

    expect(bindingMismatch.matches).toBe(false)
    expect(bindingMismatch.reason).toMatch(/binding mismatch/)
    expect(staleStop.matches).toBe(false)
    expect(staleStop.reason).toBe('delivery predates annotation submission')
  })
})
