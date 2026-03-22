# CodeTour Record & Edit — Layer 1 Extension Design

**Date**: 2026-03-22
**Status**: Approved
**Scope**: Extension-side handlers only (Layer 1). Frontend UI/UX is Layer 2, to be designed separately.

---

## Context

Code Viewer already has read-only CodeTour support:
- `tour.list` — lists all `.tours/*.tour` files
- `tour.getSteps` — loads tour steps with code snippets
- `TourListPage` + `TourDetailPage` in frontend

This spec adds **recording, editing, and commit-aware viewing** capabilities to the extension layer.

### Design Principles

1. **Align with original CodeTour format** — `.tour` files follow the standard schema (`https://aka.ms/codetour-schema`). Future "fork" will migrate descriptions to separate `.md` files; for now, keep compatibility.
2. **No git mutations** — commit-aware viewing uses `git show <ref>:<path>` (read-only), NOT `git stash/checkout/restore`. Zero risk to user's working directory.
3. **Incremental save** — every `addStep` immediately writes to disk. No finalize-to-save; `finalize` only removes the `recording` status marker.
4. **Single recording constraint** — only one tour can be in `recording` status at a time across the workspace.
5. **Backend is full-featured, frontend simplifies** — all ref options (branch, commit) exposed via API; frontend defaults to branch with commit as optional.

---

## Data Model Changes

### CodeTour (updated)

| Field | Type | Change | Notes |
|-------|------|--------|-------|
| `id` | `string` | existing | File name as ID |
| `title` | `string` | existing | |
| `description` | `string?` | existing | |
| `steps` | `TourStep[]` | existing | |
| `stepCount` | `number` | existing | |
| `ref` | `string?` | **new** | Branch name or commit hash |
| `status` | `"recording"?` | **new** | Present only during active recording |

### TourStep (updated)

| Field | Type | Change | Notes |
|-------|------|--------|-------|
| `file` | `string` | existing | Relative path from workspace root |
| `line` | `number` | existing | 1-based start line |
| `endLine` | `number?` | existing | 1-based end line (range highlight) |
| `title` | `string?` | existing | Step title |
| `description` | `string` | existing | Markdown content |
| `selection` | `{start: {line, character}, end: {line, character}}?` | **new** | Optional precise selection range (must be added to `TourStep` in `models.ts`) |

### GitStatus (updated)

Add `commitHash` to the `GitStatus` interface in `packages/shared/src/models.ts`:

| Field | Type | Change | Notes |
|-------|------|--------|-------|
| `commitHash` | `string` | **new** | Current HEAD commit hash. Source: `repo.state.HEAD?.commit` via VS Code Git API |

### ErrorCode (extended)

The existing `ErrorCode` union in `ws-types.ts` must be extended with tour-specific codes:

```typescript
export type ErrorCode =
  | 'NOT_CONNECTED'
  | 'EXTENSION_OFFLINE'
  | 'TIMEOUT'
  | 'NOT_FOUND'
  | 'INVALID_REQUEST'
  // Tour domain (new)
  | 'RECORDING_EXISTS'    // Another tour is already recording
  | 'TOUR_EXISTS'         // Slug file already exists
  | 'NOT_RECORDING'       // Tour is not in recording status
  | 'INDEX_OUT_OF_BOUNDS' // Step index out of range
  | 'REF_NOT_FOUND'       // Git ref does not exist
  | 'FILE_NOT_AT_REF'     // File not found at specified git ref
```

---

## New Message Types

### `tour.create`

**Direction**: Frontend -> Backend -> Extension
**Response**: `tour.create.result`

```typescript
// Request
{
  title: string
  ref?: string  // Default: current branch name (git branch --show-current)
                // Optional: specific commit hash
}

// Response
{
  tourId: string
  filePath: string  // e.g. ".tours/my-tour.tour"
}
```

**Behavior**:
1. Check no other tour has `status: "recording"` -> error `RECORDING_EXISTS` if found (include tourId of active recording)
2. Ensure `.tours/` directory exists (create if missing)
3. Slug title: lowercase, spaces to hyphens, strip to `[a-z0-9-]`, collapse consecutive hyphens, trim leading/trailing hyphens, truncate to 50 characters, error `INVALID_REQUEST` if result is empty
4. Check file doesn't already exist -> error `TOUR_EXISTS`
5. If `ref` not provided, get current branch via `git branch --show-current`
6. Write `.tours/{slug}.tour`:
```json
{
  "$schema": "https://aka.ms/codetour-schema",
  "title": "My Tour",
  "ref": "main",
  "status": "recording",
  "steps": []
}
```

### `tour.addStep`

**Direction**: Frontend -> Backend -> Extension
**Response**: `tour.addStep.result`

```typescript
// Request
{
  tourId: string
  file: string
  line: number
  endLine?: number
  selection?: {
    start: { line: number, character: number }
    end: { line: number, character: number }
  }
  title?: string
  description: string
  index?: number  // Insert position. Omit = append to end
}

// Response
{
  stepCount: number  // Updated total
}
```

**Behavior**:
1. Verify tour `status === "recording"` -> error `NOT_RECORDING` if not
2. Validate file path using `validatePath()` from `extension/src/utils/validate-path.ts` (prevents directory traversal)
3. If `index` provided, splice at position; otherwise push to end
4. Immediately rewrite `.tour` file to disk

### `tour.deleteStep`

**Direction**: Frontend -> Backend -> Extension
**Response**: `tour.deleteStep.result`

```typescript
// Request
{
  tourId: string
  stepIndex: number  // 0-based
}

// Response
{
  stepCount: number  // Updated total
}
```

**Behavior**:
1. Verify tour `status === "recording"` -> error `NOT_RECORDING`
2. Validate `stepIndex` in bounds -> error `INDEX_OUT_OF_BOUNDS`
3. Splice step out, rewrite file

### `tour.finalize`

**Direction**: Frontend -> Backend -> Extension
**Response**: `tour.finalize.result`

```typescript
// Request
{ tourId: string }

// Response
{ ok: true }
```

**Behavior**:
1. Verify tour `status === "recording"` -> error `NOT_RECORDING` if tour has no `status` field (covers both "never recorded" and "already finalized" — frontend shows appropriate toast based on this single code)
2. Remove `status` field from tour JSON
3. Rewrite file

### `tour.delete`

**Direction**: Frontend -> Backend -> Extension
**Response**: `tour.delete.result`

```typescript
// Request
{ tourId: string }

// Response
{ ok: true }
```

**Behavior**:
1. Verify tour file exists -> error `NOT_FOUND` if not
2. Delete the `.tour` file from disk
3. If tour was in `recording` status, that's fine — recording is implicitly cancelled

### `tour.getFileAtRef`

**Direction**: Frontend -> Backend -> Extension
**Response**: `tour.getFileAtRef.result`

```typescript
// Request
{
  ref: string | null  // null = read working tree (fallback to file.read)
  path: string        // Relative path from workspace root
}

// Response
{
  content: string
  languageId: string
  ref: string | null  // Echo back for client convenience
}
```

**Behavior**:
1. If `ref` is null/undefined -> read from working tree using `vscode.workspace.fs.readFile` (reuse file-reading logic, NOT dispatch a `file.read` message), return in `tour.getFileAtRef.result` shape
2. If `ref` provided -> execute `git show <ref>:<path>`
3. Ref not found -> error `REF_NOT_FOUND`; file doesn't exist at that ref -> error `FILE_NOT_AT_REF`
4. Determine `languageId` from file extension

---

## Modified Message Types

### `tour.list` (updated response)

```typescript
// Response (updated)
{
  tours: Array<{
    id: string
    title: string
    description?: string
    stepCount: number
    ref?: string       // NEW: branch name or commit hash
    status?: string    // NEW: "recording" if active recording
  }>
}
```

### `tour.getSteps` (updated response)

```typescript
// Response (updated)
{
  tour: {
    id: string
    title: string
    description?: string
    ref?: string       // NEW: for commit-aware viewing
  }
  steps: Array<{
    file: string
    line: number
    endLine?: number
    selection?: {      // NEW: precise selection range
      start: { line: number, character: number }
      end: { line: number, character: number }
    }
    title?: string
    description: string
  }>
}
```

### `git.status` (updated response)

```typescript
// Response (updated)
{
  branch: string
  commitHash: string   // NEW: current HEAD commit hash
  ahead: number
  behind: number
  changedFiles: Array<{ ... }>  // unchanged
}
```

---

## Error Codes

| Code | When | HTTP-like |
|------|------|-----------|
| `RECORDING_EXISTS` | `tour.create` when another tour is recording | 409 Conflict |
| `TOUR_EXISTS` | `tour.create` when slug file already exists | 409 Conflict |
| `NOT_RECORDING` | `addStep/deleteStep/finalize` on non-recording tour (covers both "never recorded" and "already finalized") | 400 Bad Request |
| `INDEX_OUT_OF_BOUNDS` | `tour.deleteStep` with invalid index | 400 Bad Request |
| `REF_NOT_FOUND` | `tour.getFileAtRef` with invalid ref | 404 Not Found |
| `FILE_NOT_AT_REF` | `tour.getFileAtRef` file doesn't exist at that ref | 404 Not Found |
| `NOT_FOUND` | Any tour operation with invalid tourId (reuses existing ErrorCode) | 404 Not Found |
| `INVALID_REQUEST` | Empty slug after sanitization (reuses existing ErrorCode) | 400 Bad Request |

---

## Message Type Constants (ws-types.ts additions)

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

// Error types (follow existing pattern: {domain}.{action}.error)
export const MSG_TOUR_CREATE_ERROR = 'tour.create.error' as const
export const MSG_TOUR_ADD_STEP_ERROR = 'tour.addStep.error' as const
export const MSG_TOUR_DELETE_STEP_ERROR = 'tour.deleteStep.error' as const
export const MSG_TOUR_FINALIZE_ERROR = 'tour.finalize.error' as const
export const MSG_TOUR_DELETE_ERROR = 'tour.delete.error' as const
export const MSG_TOUR_GET_FILE_AT_REF_ERROR = 'tour.getFileAtRef.error' as const
```

### Payload Interfaces (ws-types.ts additions)

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

export interface TourDeletePayload {
  tourId: string
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

---

## Implementation Scope

### In scope (Layer 1)
- All 6 new extension handlers above
- Updated `tour.list` and `tour.getSteps` responses
- Extended `git.status` response with `commitHash`
- Shared types in `packages/shared`
- Unit tests for each handler

### Out of scope (Layer 2 — separate spec)
- Frontend recording UI (record mode, line tap popup, preview)
- Frontend tour editing UI
- Tour description migration to `.md` files (future CodeTour fork)
- `tour.changed` event broadcast (no multi-frontend use case)

---

## Future: CodeTour Fork

User plans to fork CodeTour and change the description storage model:
- **Current**: `description` is a markdown string inline in `.tour` JSON
- **Future**: `description` becomes a path to a `.md` file, content managed separately
- Extension + frontend will be adjusted together when this happens
- Layer 1 API signatures should remain stable; only the file I/O layer changes
