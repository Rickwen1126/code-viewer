import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => {
  const repo = {
    rootUri: { fsPath: '/repo' },
    status: vi.fn(),
    state: {
      HEAD: {
        name: 'preview',
        commit: 'old-preview-head',
        ahead: 0,
        behind: 0,
      },
      indexChanges: [] as Array<{ uri: { fsPath: string }; status: number; renameUri?: { fsPath: string } }>,
      workingTreeChanges: [] as Array<{ uri: { fsPath: string }; status: number; renameUri?: { fsPath: string } }>,
    },
  }

  return {
    repo,
    asRelativePath: vi.fn((input: string | { fsPath?: string }) => {
      const fsPath = typeof input === 'string' ? input : input.fsPath ?? ''
      return fsPath.replace(/^\/repo\//, '')
    }),
  }
})

vi.mock('vscode', () => ({
  extensions: {
    getExtension: vi.fn(() => ({
      isActive: true,
      exports: {
        getAPI: vi.fn(() => ({ repositories: [mocks.repo] })),
      },
    })),
  },
  workspace: {
    asRelativePath: mocks.asRelativePath,
    workspaceFolders: [{ uri: { fsPath: '/repo' } }],
  },
  Uri: {
    joinPath: vi.fn((_base: unknown, path: string) => ({ fsPath: `/repo/${path}` })),
  },
}))

vi.mock('../ws/client', () => ({
  createMessage: vi.fn((type: string, payload: unknown, replyTo?: string) => ({
    type,
    id: 'mock-id',
    replyTo,
    payload,
    timestamp: 0,
  })),
}))

import { handleGitStatus } from '../providers/git-provider'

describe('handleGitStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.repo.state = {
      HEAD: {
        name: 'preview',
        commit: 'old-preview-head',
        ahead: 0,
        behind: 0,
      },
      indexChanges: [],
      workingTreeChanges: [],
    }
  })

  it('refreshes VS Code Git state before reading branch and changes', async () => {
    mocks.repo.status.mockImplementationOnce(async () => {
      mocks.repo.state = {
        HEAD: {
          name: 'main',
          commit: 'fresh-main-head',
          ahead: 40,
          behind: 0,
        },
        indexChanges: [
          { uri: { fsPath: '/repo/src/staged.ts' }, status: 1 },
        ],
        workingTreeChanges: [
          { uri: { fsPath: '/repo/src/unstaged.ts' }, status: 5 },
          { uri: { fsPath: '/repo/src/new-file.ts' }, status: 7 },
        ],
      }
    })

    const responses: unknown[] = []
    await handleGitStatus(
      { type: 'git.status', id: 'request-id', payload: {}, timestamp: 0 },
      (msg) => responses.push(msg),
    )

    expect(mocks.repo.status).toHaveBeenCalledOnce()
    expect(responses).toHaveLength(1)
    expect(responses[0]).toMatchObject({
      type: 'git.status.result',
      replyTo: 'request-id',
      payload: {
        branch: 'main',
        commitHash: 'fresh-main-head',
        ahead: 40,
        behind: 0,
        stagedFiles: [
          { path: 'src/staged.ts', status: 'added' },
        ],
        unstagedFiles: [
          { path: 'src/unstaged.ts', status: 'modified' },
          { path: 'src/new-file.ts', status: 'added' },
        ],
      },
    })
  })
})
