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
  buildFileChatPrompt,
  extractAssistantMessage,
  fileChatPaths,
  readFileChatConfig,
  validateFileChatPath,
} from '../providers/file-chat-provider'

const workspaceFolder = {
  uri: { fsPath: '/Users/rickwen/code/example' },
  name: 'example',
  index: 0,
} as any

describe('file chat provider path helpers', () => {
  it('uses an independent spawn profile by default', () => {
    expect(readFileChatConfig().spawnProfile).toBe('code-viewer-codex-file-chat')
  })

  it('uses the append-only current thread paths', () => {
    expect(fileChatPaths()).toEqual({
      threadId: 'current',
      manifestPath: '.codeviewer/chat-runs/current/manifest.json',
      threadPath: '.codeviewer/chat-runs/current/thread.md',
      runLogPath: '.codeviewer/chat-runs/current/run.jsonl',
    })
  })

  it('normalizes dot slash and backslashes', () => {
    const result = validateFileChatPath('./src\\index.ts', workspaceFolder)
    expect(result.relativePath).toBe('src/index.ts')
    expect(result.sourceUri.fsPath).toBe('/Users/rickwen/code/example/src/index.ts')
  })

  it('rejects absolute and traversal paths', () => {
    expect(() => validateFileChatPath('/etc/passwd', workspaceFolder)).toThrow(/workspace-relative/)
    expect(() => validateFileChatPath('../outside.ts', workspaceFolder)).toThrow(/escape/)
    expect(() => validateFileChatPath('src/../outside.ts', workspaceFolder)).toThrow(/escape/)
  })
})

describe('file chat thread parsing', () => {
  it('extracts the matching assistant block only', () => {
    const thread = [
      '## User requestId=ask-1',
      '',
      'question',
      '',
      '## Assistant requestId=ask-1',
      '',
      'answer one',
      '',
      '## User requestId=ask-2',
      '',
      'second',
      '',
      '## Assistant requestId=ask-2',
      '',
      'answer two',
    ].join('\n')

    expect(extractAssistantMessage(thread, 'ask-1')).toBe('answer one')
    expect(extractAssistantMessage(thread, 'ask-2')).toBe('answer two')
    expect(extractAssistantMessage(thread, 'ask-3')).toBeUndefined()
  })

  it('uses the latest matching assistant block when Codex compacting duplicates a header', () => {
    const thread = [
      '## User requestId=ask-1',
      '',
      'question',
      '',
      '## Assistant requestId=ask-1',
      '',
      'partial answer without newline before retry [## Assistant requestId=ask-1',
      '',
      'complete answer',
    ].join('\n')

    expect(extractAssistantMessage(thread, 'ask-1')).toBe('complete answer')
  })

  it('builds a prompt that requires appending to the current thread', () => {
    const prompt = buildFileChatPrompt({
      workspaceRoot: '/Users/rickwen/code/example',
      relativePath: 'src/index.ts',
      requestId: 'ask-1',
      question: '這段做什麼？',
      markedLines: [{ line: 1, content: 'export const n = 1' }],
    })

    expect(prompt).toContain('Thread file: .codeviewer/chat-runs/current/thread.md')
    expect(prompt).toContain('## Assistant requestId=ask-1')
    expect(prompt).toContain('L1: export const n = 1')
    expect(prompt).toContain('Use the workspace path as primary context')
    expect(prompt).not.toContain('Current source file content')
  })
})
