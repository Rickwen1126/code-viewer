# CodeTour Record & Edit — Layer 1 Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tour recording, editing, and commit-aware viewing handlers to the extension layer.

**Architecture:** Extend `tour-provider.ts` with 6 new WS handlers following existing patterns (handler function → register in `extension.ts` dispatch table). All file I/O uses `vscode.workspace.fs`. Git ref reading via `child_process.execFileSync('git', ['show', ...])` (no shell injection). Reference implementation at `~/code/codetour`.

**Tech Stack:** TypeScript, VS Code Extension API, Vitest, `ws` WebSocket

**Spec:** `docs/superpowers/specs/2026-03-22-codetour-record-edit-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `packages/shared/src/models.ts` | Add `ref`, `status` to CodeTour; `selection` to TourStep; `commitHash` to GitStatus |
| Modify | `packages/shared/src/ws-types.ts` | Add 6 new ErrorCodes, 18 message constants (12 req/res + 6 error), 10 payload interfaces |
| Modify | `extension/src/providers/tour-provider.ts` | Add 6 new handlers + update 2 existing |
| Modify | `extension/src/providers/git-provider.ts` | Add `commitHash` to git.status response |
| Modify | `extension/src/extension.ts` | Register 6 new handlers in dispatch table |
| Create | `extension/src/__tests__/tour-provider.test.ts` | Unit tests for all tour handlers |

---

### Task 1: Extend shared models

**Files:**
- Modify: `packages/shared/src/models.ts`

- [ ] **Step 1: Add `ref`, `status`, `selection` to models**

```typescript
// In models.ts, update CodeTour interface:
export interface CodeTour {
  id: string
  title: string
  description?: string
  steps: TourStep[]
  stepCount: number
  ref?: string
  status?: 'recording'
}

// Update TourStep interface:
export interface TourStep {
  file: string
  line: number
  endLine?: number
  title?: string
  description: string
  selection?: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
}

// Update GitStatus interface — add commitHash:
export interface GitStatus {
  branch: string
  commitHash: string
  ahead: number
  behind: number
  changedFiles: ChangedFile[]
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm -r typecheck`
Expected: PASS (new fields are optional, no breaking changes except `commitHash` which needs git-provider update in Task 8)

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/models.ts
git commit -m "feat(shared): add ref, status, selection, commitHash to tour/git models"
```

---

### Task 2: Extend shared WS types

**Files:**
- Modify: `packages/shared/src/ws-types.ts`

- [ ] **Step 1: Add tour ErrorCodes to the ErrorCode union**

After the existing `'INVALID_REQUEST'` line, add:

```typescript
  // Tour domain
  | 'TOUR_RECORDING_EXISTS'
  | 'TOUR_SLUG_EXISTS'
  | 'TOUR_NOT_RECORDING'
  | 'TOUR_STEP_OUT_OF_BOUNDS'
  | 'TOUR_REF_NOT_FOUND'
  | 'TOUR_FILE_NOT_AT_REF'
```

- [ ] **Step 2: Add message type constants**

After the existing `MSG_TOUR_GET_STEPS_RESULT` line, add:

```typescript
export const MSG_TOUR_CREATE = 'tour.create' as const
export const MSG_TOUR_CREATE_RESULT = 'tour.create.result' as const
export const MSG_TOUR_ADD_STEP = 'tour.addStep' as const
export const MSG_TOUR_ADD_STEP_RESULT = 'tour.addStep.result' as const
export const MSG_TOUR_DELETE_STEP = 'tour.deleteStep' as const
export const MSG_TOUR_DELETE_STEP_RESULT = 'tour.deleteStep.result' as const
export const MSG_TOUR_FINALIZE = 'tour.finalize' as const
export const MSG_TOUR_FINALIZE_RESULT = 'tour.finalize.result' as const
export const MSG_TOUR_DELETE = 'tour.delete' as const
export const MSG_TOUR_DELETE_RESULT = 'tour.delete.result' as const
export const MSG_TOUR_GET_FILE_AT_REF = 'tour.getFileAtRef' as const
export const MSG_TOUR_GET_FILE_AT_REF_RESULT = 'tour.getFileAtRef.result' as const

// Error types
export const MSG_TOUR_CREATE_ERROR = 'tour.create.error' as const
export const MSG_TOUR_ADD_STEP_ERROR = 'tour.addStep.error' as const
export const MSG_TOUR_DELETE_STEP_ERROR = 'tour.deleteStep.error' as const
export const MSG_TOUR_FINALIZE_ERROR = 'tour.finalize.error' as const
export const MSG_TOUR_DELETE_ERROR = 'tour.delete.error' as const
export const MSG_TOUR_GET_FILE_AT_REF_ERROR = 'tour.getFileAtRef.error' as const
```

- [ ] **Step 3: Add payload interfaces**

After the existing `TourGetStepsResultPayload`, add:

```typescript
export interface TourCreatePayload {
  title: string
  ref?: string
}

export interface TourCreateResultPayload {
  tourId: string
  filePath: string
}

export interface TourAddStepPayload {
  tourId: string
  file: string
  line: number
  endLine?: number
  selection?: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
  title?: string
  description: string
  index?: number
}

export interface TourAddStepResultPayload {
  stepCount: number
}

export interface TourDeleteStepPayload {
  tourId: string
  stepIndex: number
}

export interface TourDeleteStepResultPayload {
  stepCount: number
}

export interface TourFinalizePayload {
  tourId: string
}

export interface TourFinalizeResultPayload {
  ok: true
}

export interface TourDeletePayload {
  tourId: string
}

export interface TourDeleteResultPayload {
  ok: true
}

export interface TourGetFileAtRefPayload {
  ref: string | null
  path: string
}

export interface TourGetFileAtRefResultPayload {
  content: string
  languageId: string
  ref: string | null
}
```

- [ ] **Step 4: Update existing TourListResultPayload**

Add `ref` and `status` to the tour item in the existing `TourListResultPayload`:

```typescript
export interface TourListResultPayload {
  tours: Array<{
    id: string
    title: string
    description?: string
    stepCount: number
    ref?: string
    status?: 'recording'
  }>
}
```

- [ ] **Step 5: Update existing TourGetStepsResultPayload**

Add `ref` to tour and `selection` to steps:

```typescript
export interface TourGetStepsResultPayload {
  tour: {
    id: string
    title: string
    description?: string
    ref?: string
  }
  steps: Array<{
    file: string
    line: number
    endLine?: number
    selection?: {
      start: { line: number; character: number }
      end: { line: number; character: number }
    }
    title?: string
    description: string
  }>
}
```

- [ ] **Step 6: Run typecheck**

Run: `pnpm -r typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/ws-types.ts
git commit -m "feat(shared): add tour CRUD message types, payloads, and error codes"
```

---

### Task 3: Update existing tour handlers (tour.list, tour.getSteps)

**Files:**
- Modify: `extension/src/providers/tour-provider.ts`

- [ ] **Step 1: Update handleTourList to include ref and status**

In `handleTourList`, when parsing each tour JSON, also extract `ref` and `status`:

```typescript
// Inside the for loop that iterates tour files, after parsing JSON:
tours.push({
  id: name.replace('.tour', ''),
  title: tour.title || name,
  description: tour.description,
  stepCount: Array.isArray(tour.steps) ? tour.steps.length : 0,
  ref: tour.ref,
  status: tour.status,
})
```

- [ ] **Step 2: Update handleTourGetSteps to include ref and selection**

In `handleTourGetSteps`, add `ref` to the tour object and `selection` to each step:

```typescript
// Tour metadata — add ref:
const tourMeta = {
  id: tourId,
  title: tour.title || tourId,
  description: tour.description,
  ref: tour.ref,
}

// Steps mapping — add selection:
const steps = (tour.steps || []).map((s: any) => ({
  file: s.file,
  line: s.line,
  endLine: s.endLine,
  selection: s.selection,
  title: s.title,
  description: s.description || '',
}))
```

- [ ] **Step 3: Run tests**

Run: `pnpm -w run test`
Expected: All existing tests PASS

- [ ] **Step 4: Commit**

```bash
git add extension/src/providers/tour-provider.ts
git commit -m "feat(extension): add ref and status to tour.list, ref and selection to tour.getSteps"
```

---

### Task 4: Implement tour.create handler

**Files:**
- Modify: `extension/src/providers/tour-provider.ts`
- Test: `extension/src/__tests__/tour-provider.test.ts`

Reference: `~/code/codetour/src/recorder/commands.ts` (writeTourFile, getTourFileUri)

- [ ] **Step 1: Write test for tour.create**

Create `extension/src/__tests__/tour-provider.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock vscode
const mockReadDirectory = vi.fn()
const mockWriteFile = vi.fn()
const mockReadFile = vi.fn()
const mockStat = vi.fn()
const mockCreateDirectory = vi.fn()
const mockDeleteFile = vi.fn()

vi.mock('vscode', () => ({
  Uri: {
    file: vi.fn((p: string) => ({ fsPath: p })),
    joinPath: vi.fn((base: any, ...parts: string[]) => ({
      fsPath: [base.fsPath, ...parts].join('/'),
    })),
  },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/workspace' } }],
    fs: {
      readDirectory: mockReadDirectory,
      writeFile: mockWriteFile,
      readFile: mockReadFile,
      stat: mockStat,
      createDirectory: mockCreateDirectory,
      delete: mockDeleteFile,
    },
    textDocuments: [],
  },
  FileType: { File: 1, Directory: 2 },
  extensions: {
    getExtension: vi.fn(() => ({
      isActive: true,
      exports: {
        getAPI: () => ({
          repositories: [{
            rootUri: { fsPath: '/workspace' },
            state: { HEAD: { name: 'main', commit: 'abc123' } },
          }],
        }),
      },
    })),
  },
}))

vi.mock('../ws/client', () => ({
  createMessage: vi.fn((type: string, payload: unknown, replyTo?: string) => ({
    type, id: 'mock-id', replyTo, payload, timestamp: 0,
  })),
}))

import { handleTourCreate } from '../providers/tour-provider'

describe('handleTourCreate', () => {
  const send = vi.fn()
  const makeMsg = (payload: any) => ({
    type: 'tour.create', id: 'req-1', payload, timestamp: 0,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockReadDirectory.mockResolvedValue([])
    mockStat.mockRejectedValue(new Error('not found'))
  })

  it('creates a tour file with correct slug and default branch ref', async () => {
    await handleTourCreate(makeMsg({ title: 'My First Tour' }) as any, send)

    expect(mockCreateDirectory).toHaveBeenCalled()
    expect(mockWriteFile).toHaveBeenCalledOnce()

    const [uri, content] = mockWriteFile.mock.calls[0]
    expect(uri.fsPath).toContain('.tours/my-first-tour.tour')

    const parsed = JSON.parse(new TextDecoder().decode(content))
    expect(parsed.title).toBe('My First Tour')
    expect(parsed.ref).toBe('main')
    expect(parsed.status).toBe('recording')
    expect(parsed.steps).toEqual([])

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'tour.create.result',
    }))
  })

  it('rejects when another tour is already recording', async () => {
    const recordingTour = JSON.stringify({ title: 'Other', status: 'recording', steps: [] })
    mockReadDirectory.mockResolvedValue([['other.tour', 1]])
    mockReadFile.mockResolvedValue(new TextEncoder().encode(recordingTour))

    await handleTourCreate(makeMsg({ title: 'New Tour' }) as any, send)

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'tour.create.error',
      payload: expect.objectContaining({ code: 'TOUR_RECORDING_EXISTS' }),
    }))
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('rejects when slug file already exists', async () => {
    mockStat.mockResolvedValue({ type: 1 }) // file exists

    await handleTourCreate(makeMsg({ title: 'My Tour' }) as any, send)

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'tour.create.error',
      payload: expect.objectContaining({ code: 'TOUR_SLUG_EXISTS' }),
    }))
  })

  it('uses provided commit ref instead of branch', async () => {
    await handleTourCreate(makeMsg({ title: 'Pinned Tour', ref: 'deadbeef' }) as any, send)

    const [, content] = mockWriteFile.mock.calls[0]
    const parsed = JSON.parse(new TextDecoder().decode(content))
    expect(parsed.ref).toBe('deadbeef')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/rickwen/code/code-viewer && npx vitest extension/src/__tests__/tour-provider.test.ts --run`
Expected: FAIL — `handleTourCreate` is not exported

- [ ] **Step 3: Implement handleTourCreate**

Add to `extension/src/providers/tour-provider.ts`:

```typescript
function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
  return slug
}

// Reuse getWorkspaceRepo from git-provider (must be exported)
import { getWorkspaceRepo } from './git-provider'

async function loadTourJson(toursUri: vscode.Uri, fileName: string): Promise<any> {
  const fileUri = vscode.Uri.joinPath(toursUri, fileName)
  const raw = await vscode.workspace.fs.readFile(fileUri)
  return JSON.parse(new TextDecoder().decode(raw))
}

async function saveTourJson(uri: vscode.Uri, data: any): Promise<void> {
  const bytes = new TextEncoder().encode(JSON.stringify(data, null, 2))
  await vscode.workspace.fs.writeFile(uri, bytes)
}

export async function handleTourCreate(
  msg: WsMessage,
  send: (m: WsMessage) => void,
): Promise<void> {
  const { title, ref } = msg.payload as TourCreatePayload
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
  if (!workspaceFolder) {
    send(createMessage('tour.create.error', { code: 'NOT_FOUND', message: 'No workspace open' }, msg.id))
    return
  }

  const toursUri = vscode.Uri.joinPath(workspaceFolder.uri, '.tours')

  // Check no other tour is recording
  try {
    const entries = await vscode.workspace.fs.readDirectory(toursUri)
    for (const [name, type] of entries) {
      if (type !== vscode.FileType.File || !name.endsWith('.tour')) continue
      const tour = await loadTourJson(toursUri, name)
      if (tour.status === 'recording') {
        send(createMessage('tour.create.error', {
          code: 'TOUR_RECORDING_EXISTS',
          message: `Tour "${tour.title}" is already recording`,
          tourId: name.replace('.tour', ''),
        }, msg.id))
        return
      }
    }
  } catch {
    // .tours/ doesn't exist yet — that's fine
  }

  // Ensure .tours/ directory exists
  try {
    await vscode.workspace.fs.createDirectory(toursUri)
  } catch { /* already exists */ }

  // Generate slug
  const slug = slugify(title)
  if (!slug) {
    send(createMessage('tour.create.error', {
      code: 'INVALID_REQUEST',
      message: 'Title produces empty slug after sanitization',
    }, msg.id))
    return
  }

  // Check file doesn't already exist
  const tourUri = vscode.Uri.joinPath(toursUri, `${slug}.tour`)
  try {
    await vscode.workspace.fs.stat(tourUri)
    send(createMessage('tour.create.error', {
      code: 'TOUR_SLUG_EXISTS',
      message: `Tour file ${slug}.tour already exists`,
    }, msg.id))
    return
  } catch {
    // File doesn't exist — good
  }

  // Resolve ref
  const resolvedRef = ref ?? getWorkspaceRepo()?.state.HEAD?.name

  // Write tour file
  const tourData: any = {
    $schema: 'https://aka.ms/codetour-schema',
    title,
    ...(resolvedRef ? { ref: resolvedRef } : {}),
    status: 'recording',
    steps: [],
  }
  await saveTourJson(tourUri, tourData)

  send(createMessage('tour.create.result', {
    tourId: slug,
    filePath: `.tours/${slug}.tour`,
  }, msg.id))
}
```

- [ ] **Step 4: Add necessary imports at top of tour-provider.ts**

```typescript
import type { WsMessage, TourCreatePayload, TourAddStepPayload, TourDeleteStepPayload, TourFinalizePayload, TourDeletePayload, TourGetFileAtRefPayload } from '@code-viewer/shared'
```

Make sure `createMessage` import from `'../ws/client'` is present.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /Users/rickwen/code/code-viewer && npx vitest extension/src/__tests__/tour-provider.test.ts --run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add extension/src/providers/tour-provider.ts extension/src/__tests__/tour-provider.test.ts
git commit -m "feat(extension): implement tour.create handler with slug, ref, recording guard"
```

---

### Task 5: Implement tour.addStep handler

**Files:**
- Modify: `extension/src/providers/tour-provider.ts`
- Modify: `extension/src/__tests__/tour-provider.test.ts`

Reference: `~/code/codetour/src/recorder/commands.ts` (addStep splice logic)

- [ ] **Step 1: Write tests for tour.addStep**

Add to `tour-provider.test.ts`:

```typescript
import { handleTourAddStep } from '../providers/tour-provider'

describe('handleTourAddStep', () => {
  const send = vi.fn()
  const makeMsg = (payload: any) => ({
    type: 'tour.addStep', id: 'req-2', payload, timestamp: 0,
  })

  const recordingTour = {
    $schema: 'https://aka.ms/codetour-schema',
    title: 'Test Tour',
    ref: 'main',
    status: 'recording',
    steps: [],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockReadFile.mockResolvedValue(
      new TextEncoder().encode(JSON.stringify(recordingTour))
    )
    mockStat.mockResolvedValue({ type: 1 })
  })

  it('appends a step to the end', async () => {
    await handleTourAddStep(makeMsg({
      tourId: 'test-tour',
      file: 'src/index.ts',
      line: 10,
      description: 'Entry point',
    }) as any, send)

    expect(mockWriteFile).toHaveBeenCalledOnce()
    const written = JSON.parse(new TextDecoder().decode(mockWriteFile.mock.calls[0][1]))
    expect(written.steps).toHaveLength(1)
    expect(written.steps[0].file).toBe('src/index.ts')
    expect(written.steps[0].line).toBe(10)

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'tour.addStep.result',
      payload: { stepCount: 1 },
    }))
  })

  it('inserts at specific index', async () => {
    const tourWith2Steps = {
      ...recordingTour,
      steps: [
        { file: 'a.ts', line: 1, description: 'first' },
        { file: 'c.ts', line: 3, description: 'third' },
      ],
    }
    mockReadFile.mockResolvedValue(
      new TextEncoder().encode(JSON.stringify(tourWith2Steps))
    )

    await handleTourAddStep(makeMsg({
      tourId: 'test-tour',
      file: 'b.ts',
      line: 2,
      description: 'second',
      index: 1,
    }) as any, send)

    const written = JSON.parse(new TextDecoder().decode(mockWriteFile.mock.calls[0][1]))
    expect(written.steps[1].file).toBe('b.ts')
    expect(written.steps).toHaveLength(3)
  })

  it('rejects when tour is not recording', async () => {
    const finalizedTour = { ...recordingTour, status: undefined }
    delete finalizedTour.status
    mockReadFile.mockResolvedValue(
      new TextEncoder().encode(JSON.stringify(finalizedTour))
    )

    await handleTourAddStep(makeMsg({
      tourId: 'test-tour',
      file: 'x.ts',
      line: 1,
      description: 'nope',
    }) as any, send)

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ code: 'TOUR_NOT_RECORDING' }),
    }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/rickwen/code/code-viewer && npx vitest extension/src/__tests__/tour-provider.test.ts --run`
Expected: FAIL — `handleTourAddStep` not exported

- [ ] **Step 3: Implement handleTourAddStep**

Add to `tour-provider.ts`:

```typescript
export async function handleTourAddStep(
  msg: WsMessage,
  send: (m: WsMessage) => void,
): Promise<void> {
  const payload = msg.payload as TourAddStepPayload
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
  if (!workspaceFolder) {
    send(createMessage('tour.addStep.error', { code: 'NOT_FOUND', message: 'No workspace open' }, msg.id))
    return
  }

  // Validate tourId
  if (!/^[\w\-]+$/.test(payload.tourId)) {
    send(createMessage('tour.addStep.error', { code: 'INVALID_REQUEST', message: 'Invalid tour ID' }, msg.id))
    return
  }

  // Load tour
  const toursUri = vscode.Uri.joinPath(workspaceFolder.uri, '.tours')
  let tour: any
  try {
    tour = await loadTourJson(toursUri, `${payload.tourId}.tour`)
  } catch {
    send(createMessage('tour.addStep.error', { code: 'NOT_FOUND', message: 'Tour not found' }, msg.id))
    return
  }

  // Check recording
  if (tour.status !== 'recording') {
    send(createMessage('tour.addStep.error', { code: 'TOUR_NOT_RECORDING', message: 'Tour is not in recording mode' }, msg.id))
    return
  }

  // Validate path
  const validation = validatePath(payload.file, workspaceFolder)
  if (!validation.valid) {
    send(createMessage('tour.addStep.error', { code: 'INVALID_REQUEST', message: `Invalid path: ${validation.reason}` }, msg.id))
    return
  }

  // Build step
  const step: any = {
    file: payload.file,
    line: payload.line,
  }
  if (payload.endLine != null) step.endLine = payload.endLine
  if (payload.selection) step.selection = payload.selection
  if (payload.title) step.title = payload.title
  step.description = payload.description

  // Insert (let JS splice handle all index cases naturally)
  if (!Array.isArray(tour.steps)) tour.steps = []
  if (payload.index != null) {
    tour.steps.splice(payload.index, 0, step)
  } else {
    tour.steps.push(step)
  }

  // Save
  const tourUri = vscode.Uri.joinPath(toursUri, `${payload.tourId}.tour`)
  await saveTourJson(tourUri, tour)

  send(createMessage('tour.addStep.result', { stepCount: tour.steps.length }, msg.id))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/rickwen/code/code-viewer && npx vitest extension/src/__tests__/tour-provider.test.ts --run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extension/src/providers/tour-provider.ts extension/src/__tests__/tour-provider.test.ts
git commit -m "feat(extension): implement tour.addStep handler with index insert and path validation"
```

---

### Task 6: Implement tour.deleteStep handler

**Files:**
- Modify: `extension/src/providers/tour-provider.ts`
- Modify: `extension/src/__tests__/tour-provider.test.ts`

- [ ] **Step 1: Write tests for tour.deleteStep**

```typescript
import { handleTourDeleteStep } from '../providers/tour-provider'

describe('handleTourDeleteStep', () => {
  const send = vi.fn()
  const makeMsg = (payload: any) => ({
    type: 'tour.deleteStep', id: 'req-3', payload, timestamp: 0,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    const tour = {
      title: 'Test', status: 'recording',
      steps: [
        { file: 'a.ts', line: 1, description: 'first' },
        { file: 'b.ts', line: 2, description: 'second' },
      ],
    }
    mockReadFile.mockResolvedValue(new TextEncoder().encode(JSON.stringify(tour)))
  })

  it('deletes step at valid index', async () => {
    await handleTourDeleteStep(makeMsg({ tourId: 'test', stepIndex: 0 }) as any, send)
    const written = JSON.parse(new TextDecoder().decode(mockWriteFile.mock.calls[0][1]))
    expect(written.steps).toHaveLength(1)
    expect(written.steps[0].file).toBe('b.ts')
  })

  it('rejects out of bounds index', async () => {
    await handleTourDeleteStep(makeMsg({ tourId: 'test', stepIndex: 5 }) as any, send)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ code: 'TOUR_STEP_OUT_OF_BOUNDS' }),
    }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement handleTourDeleteStep**

```typescript
export async function handleTourDeleteStep(
  msg: WsMessage,
  send: (m: WsMessage) => void,
): Promise<void> {
  const { tourId, stepIndex } = msg.payload as TourDeleteStepPayload
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
  if (!workspaceFolder) {
    send(createMessage('tour.deleteStep.error', { code: 'NOT_FOUND', message: 'No workspace open' }, msg.id))
    return
  }
  if (!/^[\w\-]+$/.test(tourId)) {
    send(createMessage('tour.deleteStep.error', { code: 'INVALID_REQUEST', message: 'Invalid tour ID' }, msg.id))
    return
  }

  const toursUri = vscode.Uri.joinPath(workspaceFolder.uri, '.tours')
  let tour: any
  try {
    tour = await loadTourJson(toursUri, `${tourId}.tour`)
  } catch {
    send(createMessage('tour.deleteStep.error', { code: 'NOT_FOUND', message: 'Tour not found' }, msg.id))
    return
  }

  if (tour.status !== 'recording') {
    send(createMessage('tour.deleteStep.error', { code: 'TOUR_NOT_RECORDING', message: 'Tour is not in recording mode' }, msg.id))
    return
  }

  if (!Array.isArray(tour.steps) || stepIndex < 0 || stepIndex >= tour.steps.length) {
    send(createMessage('tour.deleteStep.error', { code: 'TOUR_STEP_OUT_OF_BOUNDS', message: `Step index ${stepIndex} out of bounds` }, msg.id))
    return
  }

  tour.steps.splice(stepIndex, 1)
  await saveTourJson(vscode.Uri.joinPath(toursUri, `${tourId}.tour`), tour)

  send(createMessage('tour.deleteStep.result', { stepCount: tour.steps.length }, msg.id))
}
```

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
git add extension/src/providers/tour-provider.ts extension/src/__tests__/tour-provider.test.ts
git commit -m "feat(extension): implement tour.deleteStep handler"
```

---

### Task 7: Implement tour.finalize and tour.delete handlers

**Files:**
- Modify: `extension/src/providers/tour-provider.ts`
- Modify: `extension/src/__tests__/tour-provider.test.ts`

- [ ] **Step 1: Write tests for both handlers**

```typescript
import { handleTourFinalize, handleTourDelete } from '../providers/tour-provider'

describe('handleTourFinalize', () => {
  const send = vi.fn()
  const makeMsg = (payload: any) => ({
    type: 'tour.finalize', id: 'req-4', payload, timestamp: 0,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    const tour = { title: 'Test', status: 'recording', steps: [{ file: 'a.ts', line: 1, description: 'x' }] }
    mockReadFile.mockResolvedValue(new TextEncoder().encode(JSON.stringify(tour)))
  })

  it('removes status field from tour', async () => {
    await handleTourFinalize(makeMsg({ tourId: 'test' }) as any, send)
    const written = JSON.parse(new TextDecoder().decode(mockWriteFile.mock.calls[0][1]))
    expect(written.status).toBeUndefined()
    expect(written.title).toBe('Test')
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'tour.finalize.result',
      payload: { ok: true },
    }))
  })

  it('rejects non-recording tour', async () => {
    mockReadFile.mockResolvedValue(new TextEncoder().encode(JSON.stringify({ title: 'Done', steps: [] })))
    await handleTourFinalize(makeMsg({ tourId: 'test' }) as any, send)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ code: 'TOUR_NOT_RECORDING' }),
    }))
  })
})

describe('handleTourDelete', () => {
  const send = vi.fn()
  const makeMsg = (payload: any) => ({
    type: 'tour.delete', id: 'req-5', payload, timestamp: 0,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mockStat.mockResolvedValue({ type: 1 })
    mockDeleteFile.mockResolvedValue(undefined)
  })

  it('deletes the tour file', async () => {
    await handleTourDelete(makeMsg({ tourId: 'test' }) as any, send)
    expect(mockDeleteFile).toHaveBeenCalledWith(
      expect.objectContaining({ fsPath: expect.stringContaining('.tours/test.tour') })
    )
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'tour.delete.result',
      payload: { ok: true },
    }))
  })

  it('rejects non-existent tour', async () => {
    mockStat.mockRejectedValue(new Error('not found'))
    await handleTourDelete(makeMsg({ tourId: 'ghost' }) as any, send)
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ code: 'NOT_FOUND' }),
    }))
  })
})
```

Note: `tour.delete` needs `vscode.workspace.fs.delete` — add it to the mock setup.

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement both handlers**

```typescript
export async function handleTourFinalize(
  msg: WsMessage,
  send: (m: WsMessage) => void,
): Promise<void> {
  const { tourId } = msg.payload as TourFinalizePayload
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
  if (!workspaceFolder) {
    send(createMessage('tour.finalize.error', { code: 'NOT_FOUND', message: 'No workspace open' }, msg.id))
    return
  }
  if (!/^[\w\-]+$/.test(tourId)) {
    send(createMessage('tour.finalize.error', { code: 'INVALID_REQUEST', message: 'Invalid tour ID' }, msg.id))
    return
  }

  const toursUri = vscode.Uri.joinPath(workspaceFolder.uri, '.tours')
  let tour: any
  try {
    tour = await loadTourJson(toursUri, `${tourId}.tour`)
  } catch {
    send(createMessage('tour.finalize.error', { code: 'NOT_FOUND', message: 'Tour not found' }, msg.id))
    return
  }

  if (tour.status !== 'recording') {
    send(createMessage('tour.finalize.error', { code: 'TOUR_NOT_RECORDING', message: 'Tour is not in recording mode' }, msg.id))
    return
  }

  delete tour.status
  await saveTourJson(vscode.Uri.joinPath(toursUri, `${tourId}.tour`), tour)

  send(createMessage('tour.finalize.result', { ok: true }, msg.id))
}

export async function handleTourDelete(
  msg: WsMessage,
  send: (m: WsMessage) => void,
): Promise<void> {
  const { tourId } = msg.payload as TourDeletePayload
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
  if (!workspaceFolder) {
    send(createMessage('tour.delete.error', { code: 'NOT_FOUND', message: 'No workspace open' }, msg.id))
    return
  }
  if (!/^[\w\-]+$/.test(tourId)) {
    send(createMessage('tour.delete.error', { code: 'INVALID_REQUEST', message: 'Invalid tour ID' }, msg.id))
    return
  }

  const tourUri = vscode.Uri.joinPath(workspaceFolder.uri, '.tours', `${tourId}.tour`)
  try {
    await vscode.workspace.fs.stat(tourUri)
  } catch {
    send(createMessage('tour.delete.error', { code: 'NOT_FOUND', message: 'Tour not found' }, msg.id))
    return
  }

  await vscode.workspace.fs.delete(tourUri)
  send(createMessage('tour.delete.result', { ok: true }, msg.id))
}
```

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add extension/src/providers/tour-provider.ts extension/src/__tests__/tour-provider.test.ts
git commit -m "feat(extension): implement tour.finalize and tour.delete handlers"
```

---

### Task 8: Implement tour.getFileAtRef handler

**Files:**
- Modify: `extension/src/providers/tour-provider.ts`
- Modify: `extension/src/__tests__/tour-provider.test.ts`

- [ ] **Step 1: Write tests**

```typescript
import { handleTourGetFileAtRef } from '../providers/tour-provider'

// Add to mock setup: mock child_process
vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}))
import { execFileSync } from 'child_process'
const mockExecFileSync = vi.mocked(execFileSync)

describe('handleTourGetFileAtRef', () => {
  const send = vi.fn()
  const makeMsg = (payload: any) => ({
    type: 'tour.getFileAtRef', id: 'req-6', payload, timestamp: 0,
  })

  beforeEach(() => vi.clearAllMocks())

  it('returns file content at git ref', async () => {
    mockExecFileSync.mockReturnValue('const x = 1;')

    await handleTourGetFileAtRef(makeMsg({ ref: 'main', path: 'src/index.ts' }) as any, send)

    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git', ['show', 'main:src/index.ts'],
      expect.objectContaining({ cwd: '/workspace' })
    )
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      type: 'tour.getFileAtRef.result',
      payload: expect.objectContaining({
        content: 'const x = 1;',
        languageId: 'typescript',
        ref: 'main',
      }),
    }))
  })

  it('reads working tree when ref is null', async () => {
    mockReadFile.mockResolvedValue(new TextEncoder().encode('hello'))

    await handleTourGetFileAtRef(makeMsg({ ref: null, path: 'readme.md' }) as any, send)

    expect(mockExecFileSync).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        content: 'hello',
        ref: null,
      }),
    }))
  })

  it('returns TOUR_REF_NOT_FOUND on bad ref', async () => {
    mockExecFileSync.mockImplementation(() => { throw new Error('fatal: bad revision') })

    await handleTourGetFileAtRef(makeMsg({ ref: 'nonexistent', path: 'src/index.ts' }) as any, send)

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ code: 'TOUR_REF_NOT_FOUND' }),
    }))
  })

  it('returns TOUR_FILE_NOT_AT_REF when file does not exist at valid ref', async () => {
    mockExecFileSync.mockImplementation(() => { throw new Error("fatal: path 'nope.ts' does not exist in 'main'") })

    await handleTourGetFileAtRef(makeMsg({ ref: 'main', path: 'src/nope.ts' }) as any, send)

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ code: 'TOUR_FILE_NOT_AT_REF' }),
    }))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement handleTourGetFileAtRef**

```typescript
import { execFileSync } from 'child_process'
import * as path from 'path'

// Simple extension → languageId mapping
const EXT_TO_LANG: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescriptreact',
  '.js': 'javascript', '.jsx': 'javascriptreact',
  '.json': 'json', '.md': 'markdown',
  '.html': 'html', '.css': 'css',
  '.py': 'python', '.rs': 'rust',
  '.go': 'go', '.java': 'java',
  '.yml': 'yaml', '.yaml': 'yaml',
  '.sh': 'shellscript', '.bash': 'shellscript',
}

function guessLanguageId(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  return EXT_TO_LANG[ext] ?? 'plaintext'
}

export async function handleTourGetFileAtRef(
  msg: WsMessage,
  send: (m: WsMessage) => void,
): Promise<void> {
  const { ref, path: filePath } = msg.payload as TourGetFileAtRefPayload
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
  if (!workspaceFolder) {
    send(createMessage('tour.getFileAtRef.error', { code: 'NOT_FOUND', message: 'No workspace open' }, msg.id))
    return
  }

  // Validate path (prevents directory traversal)
  const validation = validatePath(filePath, workspaceFolder)
  if (!validation.valid) {
    send(createMessage('tour.getFileAtRef.error', { code: 'INVALID_REQUEST', message: `Invalid path: ${validation.reason}` }, msg.id))
    return
  }

  const languageId = guessLanguageId(filePath)

  if (ref == null) {
    // Read from working tree
    try {
      const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, filePath)
      const raw = await vscode.workspace.fs.readFile(fileUri)
      const content = new TextDecoder().decode(raw)
      send(createMessage('tour.getFileAtRef.result', { content, languageId, ref: null }, msg.id))
    } catch {
      send(createMessage('tour.getFileAtRef.error', { code: 'TOUR_FILE_NOT_AT_REF', message: 'File not found' }, msg.id))
    }
    return
  }

  // Read from git ref (execFileSync — no shell injection)
  try {
    const output = execFileSync('git', ['show', `${ref}:${filePath}`], {
      cwd: workspaceFolder.uri.fsPath,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024, // 10MB
    })
    send(createMessage('tour.getFileAtRef.result', { content: output, languageId, ref }, msg.id))
  } catch (err: any) {
    const message = err?.message ?? ''
    if (message.includes('bad revision') || message.includes('unknown revision')) {
      send(createMessage('tour.getFileAtRef.error', { code: 'TOUR_REF_NOT_FOUND', message: `Git ref "${ref}" not found` }, msg.id))
    } else {
      send(createMessage('tour.getFileAtRef.error', { code: 'TOUR_FILE_NOT_AT_REF', message: `File "${filePath}" not found at ref "${ref}"` }, msg.id))
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

- [ ] **Step 5: Commit**

```bash
git add extension/src/providers/tour-provider.ts extension/src/__tests__/tour-provider.test.ts
git commit -m "feat(extension): implement tour.getFileAtRef handler with git show"
```

---

### Task 9: Extend git.status with commitHash

**Files:**
- Modify: `extension/src/providers/git-provider.ts`

- [ ] **Step 1: Add commitHash to handleGitStatus response**

In `handleGitStatus`, find where it builds the response payload and add:

```typescript
const commitHash = repo.state.HEAD?.commit ?? ''
```

Include `commitHash` in the response object alongside `branch`, `ahead`, `behind`, `changedFiles`.

- [ ] **Step 2: Run tests**

Run: `pnpm -w run test`
Expected: PASS (or update git-provider tests if they assert exact response shape)

- [ ] **Step 3: Commit**

```bash
git add extension/src/providers/git-provider.ts
git commit -m "feat(extension): add commitHash to git.status response"
```

---

### Task 10: Register all new handlers in extension.ts

**Files:**
- Modify: `extension/src/extension.ts`

- [ ] **Step 1: Add imports**

```typescript
import {
  handleTourList,
  handleTourGetSteps,
  handleTourCreate,
  handleTourAddStep,
  handleTourDeleteStep,
  handleTourFinalize,
  handleTourDelete,
  handleTourGetFileAtRef,
} from './providers/tour-provider'
```

- [ ] **Step 2: Register in handlers table**

Add after existing `'tour.getSteps': handleTourGetSteps`:

```typescript
  'tour.create': handleTourCreate,
  'tour.addStep': handleTourAddStep,
  'tour.deleteStep': handleTourDeleteStep,
  'tour.finalize': handleTourFinalize,
  'tour.delete': handleTourDelete,
  'tour.getFileAtRef': handleTourGetFileAtRef,
```

- [ ] **Step 3: Run full test suite + typecheck**

```bash
pnpm -r typecheck && pnpm -w run test
```
Expected: All PASS

- [ ] **Step 4: Commit**

```bash
git add extension/src/extension.ts
git commit -m "feat(extension): register 6 new tour handlers in dispatch table"
```

---

### Task 11: Final integration test

- [ ] **Step 1: Build extension**

```bash
cd /Users/rickwen/code/code-viewer/extension && pnpm build
```
Expected: Build succeeds

- [ ] **Step 2: Run full test suite**

```bash
cd /Users/rickwen/code/code-viewer && pnpm -r typecheck && pnpm -w run test
```
Expected: All tests PASS, zero typecheck errors

- [ ] **Step 3: Final commit**

```bash
git commit --allow-empty -m "chore: Layer 1 CodeTour Record & Edit — all handlers implemented"
```
