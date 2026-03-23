import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mocks (must come before vi.mock calls) ─────────────────────────

const { mockFs, mockWorkspaceFoldersList, mockGetWorkspaceRepo } = vi.hoisted(() => {
  const mockFs = {
    readDirectory: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    stat: vi.fn(),
    createDirectory: vi.fn(),
    delete: vi.fn(),
  }

  const mockWorkspaceFoldersList: Array<{ uri: { fsPath: string; toString: () => string } }> = [
    { uri: { fsPath: '/workspace', toString: () => 'file:///workspace' } },
  ]

  const mockGetWorkspaceRepo = vi.fn(() => ({
    rootUri: { fsPath: '/workspace' },
    state: { HEAD: { name: 'main', commit: 'abc123' } },
  }))

  return { mockFs, mockWorkspaceFoldersList, mockGetWorkspaceRepo }
})

// ── vscode mock ────────────────────────────────────────────────────────────

vi.mock('vscode', () => ({
  Uri: {
    joinPath: vi.fn((_base: any, ...segments: string[]) => {
      const basePath = _base?.fsPath ?? ''
      const joined = [basePath, ...segments].join('/')
      return { fsPath: joined, toString: () => joined }
    }),
    file: vi.fn((p: string) => ({ fsPath: p, toString: () => p })),
  },
  workspace: {
    get workspaceFolders() { return mockWorkspaceFoldersList },
    fs: mockFs,
  },
  FileType: {
    File: 1,
    Directory: 2,
  },
  extensions: {
    getExtension: vi.fn(() => ({
      isActive: true,
      exports: {
        getAPI: vi.fn(() => ({
          repositories: [
            {
              rootUri: { fsPath: '/workspace' },
              state: { HEAD: { name: 'main', commit: 'abc123' } },
            },
          ],
        })),
      },
    })),
  },
}))

// ── ws/client mock ─────────────────────────────────────────────────────────

vi.mock('../ws/client', () => ({
  createMessage: vi.fn((type: string, payload: unknown, replyTo?: string) => ({
    type,
    id: 'mock-id',
    replyTo,
    payload,
    timestamp: 0,
  })),
}))

// ── git-provider mock ──────────────────────────────────────────────────────

vi.mock('../providers/git-provider', () => ({
  getWorkspaceRepo: mockGetWorkspaceRepo,
}))

// ── validate-path mock ─────────────────────────────────────────────────────

const mockValidatePath = vi.fn(() => ({ valid: true, uri: { fsPath: '/workspace/src/index.ts' } }))

vi.mock('../utils/validate-path', () => ({
  validatePath: (...args: any[]) => mockValidatePath(...args),
}))

// ── Import after mocks ─────────────────────────────────────────────────────

import { handleTourCreate, handleTourList, handleTourGetSteps, handleTourAddStep, handleTourDeleteStep, handleTourFinalize, handleTourDelete } from '../providers/tour-provider'

// ── Helpers ────────────────────────────────────────────────────────────────

function makeMsg(payload: unknown = {}): import('@code-viewer/shared').WsMessage {
  return { type: 'tour.create', id: 'req-1', payload, timestamp: Date.now() }
}

function resetWorkspaceFolder() {
  mockWorkspaceFoldersList.length = 0
  mockWorkspaceFoldersList.push({
    uri: { fsPath: '/workspace', toString: () => 'file:///workspace' },
  })
}

// ── handleTourCreate tests ─────────────────────────────────────────────────

describe('handleTourCreate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetWorkspaceFolder()

    // Default: .tours doesn't exist (readDirectory throws, stat throws)
    mockFs.readDirectory.mockRejectedValue(new Error('ENOENT'))
    mockFs.stat.mockRejectedValue(new Error('ENOENT'))
    mockFs.createDirectory.mockResolvedValue(undefined)
    mockFs.writeFile.mockResolvedValue(undefined)

    // Default git repo
    mockGetWorkspaceRepo.mockReturnValue({
      rootUri: { fsPath: '/workspace' },
      state: { HEAD: { name: 'main', commit: 'abc123' } },
    })
  })

  it('creates a tour file with correct slug and uses branch name as ref', async () => {
    const send = vi.fn()
    await handleTourCreate(makeMsg({ title: 'My Tour', ref: undefined }), send)

    expect(mockFs.createDirectory).toHaveBeenCalled()
    expect(mockFs.writeFile).toHaveBeenCalledOnce()

    // Check the written URI contains the slug
    const [writtenUri] = mockFs.writeFile.mock.calls[0]
    expect(writtenUri.fsPath).toContain('my-tour.tour')

    // Check the written content
    const [, writtenBytes] = mockFs.writeFile.mock.calls[0]
    const written = JSON.parse(new TextDecoder().decode(writtenBytes))
    expect(written.title).toBe('My Tour')
    expect(written.ref).toBe('main')
    expect(written.status).toBe('recording')
    expect(written.steps).toEqual([])
    expect(written.$schema).toBe('https://aka.ms/codetour-schema')

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tour.create.result',
        payload: { tourId: 'my-tour', filePath: '.tours/my-tour.tour' },
      }),
    )
  })

  it('uses provided ref instead of branch name', async () => {
    const send = vi.fn()
    await handleTourCreate(makeMsg({ title: 'Pinned Tour', ref: 'v1.0.0' }), send)

    expect(mockFs.writeFile).toHaveBeenCalledOnce()
    const [, writtenBytes] = mockFs.writeFile.mock.calls[0]
    const written = JSON.parse(new TextDecoder().decode(writtenBytes))
    expect(written.ref).toBe('v1.0.0')

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'tour.create.result' }),
    )
  })

  it('rejects when another tour is already recording (TOUR_RECORDING_EXISTS)', async () => {
    // .tours exists and has a recording tour
    mockFs.readDirectory.mockResolvedValue([['existing.tour', 1]])
    mockFs.readFile.mockResolvedValue(
      new TextEncoder().encode(JSON.stringify({ title: 'Existing', status: 'recording', steps: [] })),
    )

    const send = vi.fn()
    await handleTourCreate(makeMsg({ title: 'New Tour' }), send)

    expect(mockFs.writeFile).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tour.create.error',
        payload: expect.objectContaining({ code: 'TOUR_RECORDING_EXISTS' }),
      }),
    )
  })

  it('rejects when slug file already exists (TOUR_SLUG_EXISTS)', async () => {
    // .tours doesn't have a recording tour but the slug file already exists
    mockFs.readDirectory.mockResolvedValue([['other.tour', 1]])
    mockFs.readFile.mockResolvedValue(
      new TextEncoder().encode(JSON.stringify({ title: 'Other', status: 'done', steps: [] })),
    )
    // stat succeeds — file already exists
    mockFs.stat.mockResolvedValue({ type: 1 })

    const send = vi.fn()
    await handleTourCreate(makeMsg({ title: 'Other' }), send)

    expect(mockFs.writeFile).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tour.create.error',
        payload: expect.objectContaining({ code: 'TOUR_SLUG_EXISTS' }),
      }),
    )
  })

  it('rejects when no workspace is open', async () => {
    mockWorkspaceFoldersList.length = 0
    const send = vi.fn()
    await handleTourCreate(makeMsg({ title: 'My Tour' }), send)

    expect(mockFs.writeFile).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tour.create.error',
        payload: expect.objectContaining({ code: 'NOT_FOUND' }),
      }),
    )
  })

  it('rejects when title produces an empty slug', async () => {
    const send = vi.fn()
    // Title that slugifies to empty (only special chars)
    await handleTourCreate(makeMsg({ title: '!!! ---' }), send)

    expect(mockFs.writeFile).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tour.create.error',
        payload: expect.objectContaining({ code: 'INVALID_REQUEST' }),
      }),
    )
  })

  it('omits ref field when no ref provided and git repo has no HEAD name', async () => {
    mockGetWorkspaceRepo.mockReturnValueOnce({
      rootUri: { fsPath: '/workspace' },
      state: { HEAD: { name: undefined, commit: 'abc123' } },
    } as any)

    const send = vi.fn()
    await handleTourCreate(makeMsg({ title: 'No Ref Tour' }), send)

    expect(mockFs.writeFile).toHaveBeenCalledOnce()
    const [, writtenBytes] = mockFs.writeFile.mock.calls[0]
    const written = JSON.parse(new TextDecoder().decode(writtenBytes))
    expect(written.ref).toBeUndefined()
  })
})

// ── handleTourList tests ───────────────────────────────────────────────────

describe('handleTourList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetWorkspaceFolder()
  })

  it('returns empty list when .tours directory does not exist', async () => {
    mockFs.readDirectory.mockRejectedValue(new Error('ENOENT'))
    const send = vi.fn()
    await handleTourList(makeMsg(), send)
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'tour.list.result', payload: { tours: [] } }),
    )
  })

  it('returns tour list with ref and status fields', async () => {
    mockFs.readDirectory.mockResolvedValue([['my-tour.tour', 1]])
    mockFs.readFile.mockResolvedValue(
      new TextEncoder().encode(JSON.stringify({
        title: 'My Tour',
        description: 'desc',
        ref: 'main',
        status: 'recording',
        steps: [{ file: 'a.ts', line: 1, description: 'step' }],
      })),
    )

    const send = vi.fn()
    await handleTourList(makeMsg(), send)

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tour.list.result',
        payload: {
          tours: [
            expect.objectContaining({
              id: 'my-tour',
              title: 'My Tour',
              description: 'desc',
              stepCount: 1,
              ref: 'main',
              status: 'recording',
            }),
          ],
        },
      }),
    )
  })
})

// ── handleTourGetSteps tests ───────────────────────────────────────────────

describe('handleTourGetSteps', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetWorkspaceFolder()
  })

  it('returns ref in tour metadata and selection in steps', async () => {
    const stepSelection = { start: { line: 2, character: 0 }, end: { line: 5, character: 10 } }
    mockFs.readFile.mockResolvedValue(
      new TextEncoder().encode(JSON.stringify({
        title: 'My Tour',
        ref: 'main',
        steps: [
          { file: 'src/index.ts', line: 10, description: 'A step', selection: stepSelection },
        ],
      })),
    )

    const send = vi.fn()
    await handleTourGetSteps({ ...makeMsg(), payload: { tourId: 'my-tour' } }, send)

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tour.getSteps.result',
        payload: expect.objectContaining({
          tour: expect.objectContaining({ ref: 'main' }),
          steps: [
            expect.objectContaining({ selection: stepSelection }),
          ],
        }),
      }),
    )
  })
})

// ── handleTourAddStep tests ────────────────────────────────────────────────

describe('handleTourAddStep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetWorkspaceFolder()
    mockValidatePath.mockReturnValue({ valid: true, uri: { fsPath: '/workspace/src/index.ts' } })
    mockFs.writeFile.mockResolvedValue(undefined)
  })

  function makeTourJson(overrides: Record<string, any> = {}) {
    return new TextEncoder().encode(JSON.stringify({
      title: 'My Tour',
      status: 'recording',
      steps: [],
      ...overrides,
    }))
  }

  it('appends a step to the end of the tour', async () => {
    mockFs.readFile.mockResolvedValue(makeTourJson({ steps: [{ file: 'a.ts', line: 1, description: 'existing' }] }))
    const send = vi.fn()
    await handleTourAddStep({
      ...makeMsg(),
      payload: { tourId: 'my-tour', file: 'src/index.ts', line: 5, description: 'New step' },
    }, send)

    expect(mockFs.writeFile).toHaveBeenCalledOnce()
    const [, writtenBytes] = mockFs.writeFile.mock.calls[0]
    const written = JSON.parse(new TextDecoder().decode(writtenBytes))
    expect(written.steps).toHaveLength(2)
    expect(written.steps[1]).toMatchObject({ file: 'src/index.ts', line: 5, description: 'New step' })

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tour.addStep.result',
        payload: { stepCount: 2 },
      }),
    )
  })

  it('inserts a step at a specific index', async () => {
    mockFs.readFile.mockResolvedValue(makeTourJson({
      steps: [
        { file: 'a.ts', line: 1, description: 'first' },
        { file: 'b.ts', line: 2, description: 'second' },
      ],
    }))
    const send = vi.fn()
    await handleTourAddStep({
      ...makeMsg(),
      payload: { tourId: 'my-tour', file: 'src/index.ts', line: 5, description: 'inserted', index: 1 },
    }, send)

    const [, writtenBytes] = mockFs.writeFile.mock.calls[0]
    const written = JSON.parse(new TextDecoder().decode(writtenBytes))
    expect(written.steps).toHaveLength(3)
    expect(written.steps[1]).toMatchObject({ file: 'src/index.ts', description: 'inserted' })
    expect(written.steps[2]).toMatchObject({ file: 'b.ts', description: 'second' })
  })

  it('rejects when tour is not in recording mode (TOUR_NOT_RECORDING)', async () => {
    mockFs.readFile.mockResolvedValue(makeTourJson({ status: 'done' }))
    const send = vi.fn()
    await handleTourAddStep({
      ...makeMsg(),
      payload: { tourId: 'my-tour', file: 'src/index.ts', line: 1, description: 'step' },
    }, send)

    expect(mockFs.writeFile).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tour.addStep.error',
        payload: expect.objectContaining({ code: 'TOUR_NOT_RECORDING' }),
      }),
    )
  })

  it('rejects with NOT_FOUND when tour file does not exist', async () => {
    mockFs.readFile.mockRejectedValue(new Error('ENOENT'))
    const send = vi.fn()
    await handleTourAddStep({
      ...makeMsg(),
      payload: { tourId: 'my-tour', file: 'src/index.ts', line: 1, description: 'step' },
    }, send)

    expect(mockFs.writeFile).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tour.addStep.error',
        payload: expect.objectContaining({ code: 'NOT_FOUND' }),
      }),
    )
  })

  it('rejects invalid tour ID format', async () => {
    const send = vi.fn()
    await handleTourAddStep({
      ...makeMsg(),
      payload: { tourId: '../evil', file: 'src/index.ts', line: 1, description: 'step' },
    }, send)

    expect(mockFs.writeFile).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tour.addStep.error',
        payload: expect.objectContaining({ code: 'INVALID_REQUEST' }),
      }),
    )
  })

  it('rejects invalid file path', async () => {
    mockFs.readFile.mockResolvedValue(makeTourJson())
    mockValidatePath.mockReturnValueOnce({ valid: false, reason: 'Path outside workspace' })
    const send = vi.fn()
    await handleTourAddStep({
      ...makeMsg(),
      payload: { tourId: 'my-tour', file: '../outside.ts', line: 1, description: 'step' },
    }, send)

    expect(mockFs.writeFile).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tour.addStep.error',
        payload: expect.objectContaining({ code: 'INVALID_REQUEST' }),
      }),
    )
  })
})

// ── handleTourDeleteStep tests ─────────────────────────────────────────────

describe('handleTourDeleteStep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetWorkspaceFolder()
    mockFs.writeFile.mockResolvedValue(undefined)
  })

  function makeTourJson(overrides: Record<string, any> = {}) {
    return new TextEncoder().encode(JSON.stringify({
      title: 'My Tour',
      status: 'recording',
      steps: [
        { file: 'a.ts', line: 1, description: 'first' },
        { file: 'b.ts', line: 2, description: 'second' },
        { file: 'c.ts', line: 3, description: 'third' },
      ],
      ...overrides,
    }))
  }

  it('deletes a step at a valid index', async () => {
    mockFs.readFile.mockResolvedValue(makeTourJson())
    const send = vi.fn()
    await handleTourDeleteStep({
      ...makeMsg(),
      payload: { tourId: 'my-tour', stepIndex: 1 },
    }, send)

    expect(mockFs.writeFile).toHaveBeenCalledOnce()
    const [, writtenBytes] = mockFs.writeFile.mock.calls[0]
    const written = JSON.parse(new TextDecoder().decode(writtenBytes))
    expect(written.steps).toHaveLength(2)
    expect(written.steps[0]).toMatchObject({ file: 'a.ts' })
    expect(written.steps[1]).toMatchObject({ file: 'c.ts' })

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tour.deleteStep.result',
        payload: { stepCount: 2 },
      }),
    )
  })

  it('rejects out of bounds step index (TOUR_STEP_OUT_OF_BOUNDS)', async () => {
    mockFs.readFile.mockResolvedValue(makeTourJson())
    const send = vi.fn()
    await handleTourDeleteStep({
      ...makeMsg(),
      payload: { tourId: 'my-tour', stepIndex: 10 },
    }, send)

    expect(mockFs.writeFile).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tour.deleteStep.error',
        payload: expect.objectContaining({ code: 'TOUR_STEP_OUT_OF_BOUNDS' }),
      }),
    )
  })

  it('rejects negative step index (TOUR_STEP_OUT_OF_BOUNDS)', async () => {
    mockFs.readFile.mockResolvedValue(makeTourJson())
    const send = vi.fn()
    await handleTourDeleteStep({
      ...makeMsg(),
      payload: { tourId: 'my-tour', stepIndex: -1 },
    }, send)

    expect(mockFs.writeFile).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tour.deleteStep.error',
        payload: expect.objectContaining({ code: 'TOUR_STEP_OUT_OF_BOUNDS' }),
      }),
    )
  })

  it('rejects when tour is not in recording mode (TOUR_NOT_RECORDING)', async () => {
    mockFs.readFile.mockResolvedValue(makeTourJson({ status: 'done' }))
    const send = vi.fn()
    await handleTourDeleteStep({
      ...makeMsg(),
      payload: { tourId: 'my-tour', stepIndex: 0 },
    }, send)

    expect(mockFs.writeFile).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tour.deleteStep.error',
        payload: expect.objectContaining({ code: 'TOUR_NOT_RECORDING' }),
      }),
    )
  })
})

// ── handleTourFinalize tests ───────────────────────────────────────────────

describe('handleTourFinalize', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetWorkspaceFolder()
    mockFs.writeFile.mockResolvedValue(undefined)
  })

  function makeTourJson(overrides: Record<string, any> = {}) {
    return new TextEncoder().encode(JSON.stringify({
      title: 'My Tour',
      status: 'recording',
      steps: [{ file: 'a.ts', line: 1, description: 'step' }],
      ...overrides,
    }))
  }

  it('removes the status field from the tour and saves', async () => {
    mockFs.readFile.mockResolvedValue(makeTourJson())
    const send = vi.fn()
    await handleTourFinalize({
      ...makeMsg(),
      payload: { tourId: 'my-tour' },
    }, send)

    expect(mockFs.writeFile).toHaveBeenCalledOnce()
    const [, writtenBytes] = mockFs.writeFile.mock.calls[0]
    const written = JSON.parse(new TextDecoder().decode(writtenBytes))
    expect(written.status).toBeUndefined()
    expect(written.title).toBe('My Tour')

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tour.finalize.result',
        payload: { ok: true },
      }),
    )
  })

  it('rejects when tour is not in recording mode (TOUR_NOT_RECORDING)', async () => {
    mockFs.readFile.mockResolvedValue(makeTourJson({ status: 'done' }))
    const send = vi.fn()
    await handleTourFinalize({
      ...makeMsg(),
      payload: { tourId: 'my-tour' },
    }, send)

    expect(mockFs.writeFile).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tour.finalize.error',
        payload: expect.objectContaining({ code: 'TOUR_NOT_RECORDING' }),
      }),
    )
  })

  it('rejects when tour file does not exist (NOT_FOUND)', async () => {
    mockFs.readFile.mockRejectedValue(new Error('ENOENT'))
    const send = vi.fn()
    await handleTourFinalize({
      ...makeMsg(),
      payload: { tourId: 'my-tour' },
    }, send)

    expect(mockFs.writeFile).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tour.finalize.error',
        payload: expect.objectContaining({ code: 'NOT_FOUND' }),
      }),
    )
  })
})

// ── handleTourDelete tests ─────────────────────────────────────────────────

describe('handleTourDelete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetWorkspaceFolder()
    mockFs.delete.mockResolvedValue(undefined)
  })

  it('deletes the tour file and sends ok result', async () => {
    // stat succeeds — file exists
    mockFs.stat.mockResolvedValue({ type: 1 })
    const send = vi.fn()
    await handleTourDelete({
      ...makeMsg(),
      payload: { tourId: 'my-tour' },
    }, send)

    expect(mockFs.delete).toHaveBeenCalledOnce()
    const [deletedUri] = mockFs.delete.mock.calls[0]
    expect(deletedUri.fsPath).toContain('my-tour.tour')

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tour.delete.result',
        payload: { ok: true },
      }),
    )
  })

  it('rejects when tour file does not exist (NOT_FOUND)', async () => {
    // stat throws — file doesn't exist
    mockFs.stat.mockRejectedValue(new Error('ENOENT'))
    const send = vi.fn()
    await handleTourDelete({
      ...makeMsg(),
      payload: { tourId: 'my-tour' },
    }, send)

    expect(mockFs.delete).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tour.delete.error',
        payload: expect.objectContaining({ code: 'NOT_FOUND' }),
      }),
    )
  })

  it('rejects invalid tour ID format', async () => {
    const send = vi.fn()
    await handleTourDelete({
      ...makeMsg(),
      payload: { tourId: '../evil' },
    }, send)

    expect(mockFs.delete).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tour.delete.error',
        payload: expect.objectContaining({ code: 'INVALID_REQUEST' }),
      }),
    )
  })
})
