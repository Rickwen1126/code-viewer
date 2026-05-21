# Code Annotation via tmux-adapter Spec

Created: 2026-05-21 07:16
Last Updated: 2026-05-21 20:20
Status: implementation correction in progress: artifact format restored to source-language inline annotation

## Purpose

Implement Code Viewer annotation generation by delegating agent process
acquisition and messaging to `tmux-adapter`.

The goal is not to make Code Viewer a tmux/process manager. Code Viewer should
ask for an annotation for the currently selected workspace/file. `tmux-adapter`
should ensure there is one active Codex-capable target for that workspace,
reuse it when possible, spawn only when necessary, and send the annotation task
to that target.

## Current Implementation Snapshot

Implemented in Code Viewer:

- Shared protocol constants and payloads for `annotation.generate` and
  `annotation.status`.
- Extension provider that derives cwd from VS Code, validates workspace-relative
  paths, calls `tmux-adapter ensure-target + send`, and writes/reads artifacts
  under `.codeviewer/annotated/<relative path>`.
- Frontend original/annotated toggle, annotation ready/error/submitting/waiting
  status, generate action, and menu-level `Regen Annotation`.
- Mobile visual verification on iPhone viewport 390x844: original view,
  annotated source-code view, and Regen menu must render without document-level
  horizontal overflow.

Runtime verification:

- After explicit user approval, the stale reserved `4801` frontend process was
  restarted with forced Vite refresh. Standard URL
  `http://127.0.0.1:4801/files/packages/shared/src/links.ts` now serves the
  annotation UI and passed the same iPhone 390x844 Playwright smoke.

## Mental Model

Think of Code Viewer as the person pointing at a file and saying:

```text
annotate this file in this workspace
```

Think of `tmux-adapter` as the local dispatch desk that knows:

```text
which Codex pane already belongs to this workspace
whether it is still alive
how to start one if none is alive
how to send a message to it
```

So Code Viewer should never ask, "which pane do I own?" It should ask:

```text
for this workspace cwd, give me the current usable Codex target
```

That target may be reused or newly spawned. Code Viewer does not care, except
for status display and debugging.

## Source Contract

Canonical `tmux-adapter` side:

- `/Users/rickwen/code/tmux-adapter/docs/core-spawn-primitive/spec.md`
- `/Users/rickwen/code/tmux-adapter/docs/core-spawn-primitive/smoke@2026-05-21-0707.md`
- Commit: `0a6d1f6 feat: add workspace target acquisition`

Accepted invariant:

```text
one code-viewer workspace
  -> one active Codex-capable binding slot
```

Not accepted:

```text
one code-viewer workspace
  -> one hard-coded Codex pid/pane/session forever
```

## System Architecture

Code Viewer current path:

```text
Frontend PWA
  -> Backend WebSocket relay
  -> VS Code Extension provider
```

Annotation path:

```text
Frontend action
  -> annotation.generate WS request
  -> Extension annotation provider
  -> derive workspace cwd from VS Code
  -> tmux-adapter ensure-target
  -> tmux-adapter send annotation prompt
  -> generated artifact under workspace
  -> frontend can read/display annotated artifact
```

`tmux-adapter` path:

```text
ensure-target
  -> validate invoker/profile/cwd
  -> refresh compatible active bindings
  -> return reused binding if one exists
  -> otherwise spawn tmux pane + Codex
```

## Product Behavior

### V1 User Flow

1. User opens a file in Code Viewer.
2. User chooses `Generate Annotation`.
3. Frontend sends `annotation.generate` with the selected relative file path.
4. Extension derives workspace cwd from VS Code.
5. Extension calls `tmux-adapter ensure-target`.
6. Extension sends an annotation task to the returned binding.
7. Codex writes the generated annotation artifact.
8. Frontend receives an immediate request result that includes the target
   acquisition status and artifact path.
9. Frontend can switch between original and annotated view once the artifact
   exists.

For V1, the response may be "task submitted" rather than "annotation fully
completed" if Code Viewer does not yet subscribe to Codex completion events.
The acceptance smoke must still prove the file artifact is actually produced.

### Artifact Location

Use workspace-local generated artifacts, not daemon registry state:

```text
.codeviewer/annotated/<relative-file-path>
```

Implementation detail: encode nested paths safely and preserve the original
extension so Code Viewer can keep using the existing code highlighter:

```text
.codeviewer/annotated/<relative path>
```

Example:

```text
src/providers/file-provider.ts
  -> .codeviewer/annotated/src/providers/file-provider.ts
```

`.codeviewer/` should be ignored by git. It is artifact cache/state, not source.

### Display Behavior

V1 display can be simple:

- Original mode reads the original file through existing `file.read`.
- Annotated mode reads the generated `.codeviewer/annotated/...` file.
- If annotation file does not exist, show a generate action.
- `Regen Annotation` sends the same request and overwrites the annotation
  artifact.

Do not store the active binding in frontend state as durable truth. It may be
shown as debug metadata only.

## Protocol Additions

Add message types in `packages/shared/src/ws-types.ts`:

```ts
export const MSG_ANNOTATION_GENERATE = 'annotation.generate' as const
export const MSG_ANNOTATION_GENERATE_RESULT = 'annotation.generate.result' as const
export const MSG_ANNOTATION_STATUS = 'annotation.status' as const
export const MSG_ANNOTATION_STATUS_RESULT = 'annotation.status.result' as const
```

Payloads:

```ts
export interface AnnotationGeneratePayload {
  path: string
  force?: boolean
  generationId?: string
}

export interface AnnotationGenerateResultPayload {
  path: string
  annotationPath: string
  generationId: string
  submittedAt: number
  target: {
    bindingId: string
    acquired: 'reused' | 'spawned'
    paneId?: string
    paneTarget?: string
    pid?: string
    targetScopeKey?: string
  }
  submitted: true
}

export interface AnnotationStatusPayload {
  path: string
  generationId?: string
  minUpdatedAt?: number
}

export type AnnotationArtifactState = 'missing' | 'pending' | 'ready' | 'invalid' | 'stale'

export interface AnnotationArtifactValidation {
  ok: boolean
  diagnostics: string[]
  sourceLineCount?: number
  artifactLineCount?: number
  size?: number
  updatedAt?: number
}

export interface AnnotationStatusResultPayload {
  path: string
  annotationPath: string
  exists: boolean
  ready: boolean
  state: AnnotationArtifactState
  generationId?: string
  updatedAt?: number
  validation?: AnnotationArtifactValidation
}
```

Error behavior should use existing WebSocket error conventions:

```text
annotation.generate.error
  payload: { code: 'INVALID_REQUEST' | 'NOT_FOUND' | 'EXTENSION_OFFLINE', message: string }
```

If the current `ErrorCode` union is too narrow, add only the minimum new code
needed. Do not invent a broad error taxonomy in V1.

## Extension Implementation

Add:

```text
extension/src/providers/annotation-provider.ts
```

Register handlers in `extension/src/extension.ts`:

```ts
'annotation.generate': handleAnnotationGenerate,
'annotation.status': handleAnnotationStatus,
```

### Workspace CWD Authority

The extension must derive cwd from VS Code:

```ts
const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
const workspaceRoot = workspaceFolder?.uri.fsPath
```

Reject if no workspace folder exists.

Frontend payload must never provide cwd. Frontend provides relative file intent
only.

### Path Validation

Reuse existing path validation patterns from:

```text
extension/src/utils/validate-path.ts
extension/src/providers/file-provider.ts
```

Rules:

- `path` must be a workspace-relative file path.
- Reject absolute paths.
- Reject `..` escape.
- Ensure the source file exists before generating.
- Ensure annotation output path stays under `.codeviewer/annotated/`.

### tmux-adapter CLI Wrapper

MVP can use the `tmux-adapter` CLI via Node child process. Use `spawnFile` /
`execFile` style calls, not `shell: true`.

Suggested helper:

```text
extension/src/providers/tmux-adapter-client.ts
```

Config additions in `extension/package.json`:

```json
{
  "codeViewer.tmuxAdapterCommand": {
    "type": "string",
    "default": "tmux-adapter",
    "description": "tmux-adapter CLI command used for Code Viewer annotation generation."
  },
  "codeViewer.tmuxAdapterStateRoot": {
    "type": "string",
    "default": "",
    "description": "Optional tmux-adapter state root. Empty uses tmux-adapter default."
  },
  "codeViewer.annotationSpawnProfile": {
    "type": "string",
    "default": "code-viewer-codex-annotation",
    "description": "tmux-adapter spawn profile for annotation generation."
  }
}
```

Do not hardcode `/Users/rickwen/code/tmux-adapter` into the extension. The CLI
must be operator-configurable because VS Code extension hosts may have a thinner
PATH.

### ensure-target Call

Command shape:

```text
tmux-adapter ensure-target \
  --invoker-adapter-id code-viewer \
  --spawn-profile code-viewer-codex-annotation \
  --cwd <workspaceRoot> \
  --spawn-timeout 5
```

If `codeViewer.tmuxAdapterStateRoot` is configured, add:

```text
--state-root <stateRoot>
```

Parse JSON stdout and require:

```text
data.binding_id
data.acquired in {reused, spawned}
data.target.status == active
```

### send Call

Use a temporary prompt file or stdin-backed message file to avoid shell quoting
issues.

Command shape:

```text
tmux-adapter send \
  --binding-id <bindingId> \
  --message-file <promptFile> \
  --submit-enters 1 \
  --submit-delay 0.05
```

The CLI returns `sent: true`. Treat `sent: true` only as submission evidence,
not annotation completion evidence.

### Prompt Contract

The prompt should be explicit and file-bounded:

```text
You are generating a Code Viewer annotation artifact.

Workspace: <workspaceRoot>
Source file: <relativePath>
Output file: <annotationPath>

Task:
- Read the source file.
- Copy the source file into the output file and add deep syntax/API comments
  inline.
- Preserve the source language and original file extension so Code Viewer syntax
  highlighting still works.
- Use comment syntax that is valid for the source language.

Annotation goal:
- This artifact is a syntax-first reading aid, not a summary and not a code
  review.
- Priority 1: explain language syntax, standard-library APIs,
  framework/library APIs, object shapes, method return values, and
  testing/mocking mechanics.
- Priority 2: explain the code intent, data flow, contracts, edge cases, and
  failure modes after the syntax/API layer is clear.
- The reader should not need to separately look up common syntax, API behavior,
  or library/test helper meaning while reading this file.

Commenting rules:
- Add many comments; comments being longer than the original code is
  acceptable.
- Prefer many short nearby comments over a few long summary comments.
- For dense logic or tests, aim for a comment every 1-3 source lines.
- For multi-line object literals, argument lists, arrays, dicts, config blocks,
  or test fixtures, add comments before important fields or field groups; do not
  leave the whole literal as unexplained data.
- Explain every import and every external API on first meaningful use.
- Explain non-obvious language constructs: type annotations, generics,
  decorators, context managers, async/await, destructuring, default/optional
  parameters, closures, callbacks, assertions, fixtures, mocks, and monkey
  patches.
- For every assertion, explain what contract it protects and what
  bug/regression would be caught if it failed.
- For every Mock, patch, fake client, fixture, tempfile, Path, JSON
  parse/stringify, subprocess, CLI parser, or WebSocket/API call, explain the
  concrete API behavior being used.
- For tests, explain what is mocked, what remains real, what behavior is
  isolated, and what contract each assertion protects.
- Use separate comment lines immediately above the relevant line or block by
  default.
- Use trailing inline comments only for very short notes that keep the whole
  line readable on mobile; do not put long explanations after import lines,
  field declarations, function calls, or return fields.
- Avoid vague summary-only comments such as "test register works"; explain the
  syntax/API mechanics and why the line is written that way.
- Do not add generic filler comments to satisfy density checks. Bad examples:
  "auto note", "continuous code section", "line-by-line details below",
  "complete source ends here".
- Use dense Traditional Chinese comments; keep API names, library names, and
  technical terms in English when clearer.
- If behavior is inferred rather than directly visible from this file, label it
  as "Inference:" in the comment.
- Preserve the original code order and behavior; do not remove source code.
- Prefer separate comment lines above code over long trailing comments, because
  the artifact should be easy to scan on mobile.
- Keep inserted comments indented with the nearby code they explain; comments
  inside multi-line calls, arrays, dicts, or object literals should visually
  attach to the nearby field/group.
- The annotated artifact should remain syntactically valid source whenever the
  language supports comments without changing behavior.

Generation cadence:
- Annotate as you copy the source; do not create a sparse draft and then spend
  many repair passes filling gaps.
- Use a steady first-pass cadence: for imports, function signatures, branching
  logic, external API calls, mocks/patches, assertions, and multi-line
  config/object literals, add nearby comments immediately.
- For TypeScript interfaces/types, Python dataclasses/classes, CLI argument
  arrays, JSON parsing, subprocess calls, and error normalization, add comments
  near each field group and contract boundary during the first pass.
- For simple repeated literal fields, group adjacent fields and explain the
  group once, then explain only fields whose semantics differ.
- Aim for no long unexplained meaningful block, but do not run a mechanical
  density-lint loop.
- If you notice a sparse important block while writing, add concrete comments
  immediately before moving on.
- Each inserted comment must explain concrete nearby syntax, symbols, fields,
  literals, APIs, object shapes, or contracts.

Short final check before DONE:
- Verify the output file exists, preserves source order, and includes the end of
  the source file.
- Verify important middle and tail sections received useful comments, not only
  imports and the first functions.
- Verify there are no generic filler comments, no literal `\n` artifacts inside
  comments, and no Markdown fences.
- When practical, verify the annotated artifact remains syntactically valid
  source.

Writing strategy:
- Complete this as one annotation task for the whole source file; do not ask the
  user to split the file.
- Avoid one huge heredoc or one huge tool-call argument for the entire annotated
  file.
- For medium or large files, create/truncate the output file first, then append
  the annotated content in small ordered chunks.
- After each append chunk, continue from the next source line until the whole
  file has been copied and annotated.
- If a chunk write fails because the generated command is too large or
  malformed, retry with a smaller chunk instead of stopping.
- Before replying DONE, verify the output file exists, preserves the original
  source order, and includes the end of the source file.

Boundaries:
- Do not wrap the output in Markdown fences.
- Do not modify the source file.
- Do not modify files outside .codeviewer/annotated.
- When done, reply with DONE and the output path.
```

Do not ask Codex to edit arbitrary project files in annotation mode.

### Completion Model

V1 is submit-and-poll, but status is generation-aware:

1. Frontend creates a `generationId` before calling `annotation.generate`.
2. `annotation.generate` submits the task and returns `submitted: true`,
   `generationId`, and `submittedAt`.
3. Frontend periodically calls `annotation.status` with `generationId` and
   `minUpdatedAt = submittedAt`.
4. `annotation.status` checks whether the artifact exists, was updated after
   this generation was submitted, and passes artifact validation.
5. Frontend enables annotated view only when `ready: true`, not merely when an
   old artifact exists.

Later versions can subscribe to tmux-adapter events or provider output, but V1
should stay small and evidence-driven.

## Backend Impact

No backend feature logic should be needed for V1. The existing relay forwards
frontend requests to the selected extension and routes responses back.

Only update backend tests if new message types require explicit allow-list or
routing assertions.

## Frontend Implementation

Primary file:

```text
frontend/src/pages/files/code-viewer.tsx
```

Expected controls:

- Original / Annotated toggle.
- Generate Annotation action when no artifact exists.
- Regen Annotation action in the file menu.
- Clear status states:
  - no annotation
  - submitting
  - waiting for artifact
  - annotation ready
  - error

Do not show implementation prose in the app. Use concise operational labels.

Frontend request shape:

```ts
request<AnnotationGeneratePayload, AnnotationGenerateResultPayload>(
  'annotation.generate',
  { path: currentFile.path, force: true },
  30000,
)
```

Status polling shape:

```ts
request<AnnotationStatusPayload, AnnotationStatusResultPayload>(
  'annotation.status',
  { path: currentFile.path },
  5000,
)
```

## Development Phases

### Phase 0: Todo/spec alignment

- Update `docs/todo.md` Code Annotation MVP wording to reference this spec.
- Mark old `.codeviewer/panel.json` binding wording as superseded.
- Keep `.codeviewer/` only as generated artifact cache.

### Phase 1: Shared protocol

- Add annotation message constants and payload types.
- Add model tests for constants/payload shape if the repo pattern expects it.

### Phase 2: Extension provider

- Add `tmux-adapter-client.ts`.
- Add `annotation-provider.ts`.
- Add config keys for CLI command/state root/spawn profile.
- Register handlers in `extension.ts`.
- Unit test:
  - cwd comes from VS Code workspace.
  - absolute/escaping paths rejected.
  - `ensure-target` called before `send`.
  - reused/spawned result is returned.
  - `send` failure returns `annotation.generate.error`.
  - `annotation.status` reports artifact existence.

### Phase 3: Frontend UI

- Add original/annotated toggle.
- Add generate / regen actions.
- Add submit/status/error states.
- Unit test mode switching and request payloads.

### Phase 4: E2E smoke

Run a local smoke that proves the full path:

```text
frontend action
  -> backend relay
  -> extension annotation provider
  -> tmux-adapter ensure-target
  -> spawned or reused Codex
  -> Codex writes annotation artifact
  -> frontend displays annotation artifact
```

Both spawn and reuse must be verified:

- First run starts from no active binding and must return `acquired: spawned`.
- Second run for the same workspace must return `acquired: reused`.
- File-level evidence must confirm the annotation artifact exists and contains
  expected marker/content.

## Acceptance Criteria

Code is not done until all of these are true:

- `annotation.generate` exists end to end from frontend to extension.
- Extension derives cwd from VS Code workspace, not frontend payload.
- Extension calls `tmux-adapter ensure-target` before `send`.
- Spawn path is covered by live smoke.
- Reuse path is covered by live smoke.
- Codex actually writes an annotation artifact under `.codeviewer/annotated`.
- Frontend can display the generated annotation artifact.
- Frontend displays the annotated artifact through the normal `CodeBlock`
  source-code renderer, not as rendered Markdown.
- Source file is not modified by annotation generation.
- `.codeviewer/` is ignored by git.
- Unit tests cover path validation, CLI wrapper behavior, generate/status
  handlers, and UI request/status states.
- Repo validation passes:
  - `pnpm -r typecheck`
  - `pnpm -w run test`
  - relevant build command(s)
  - mobile E2E checklist if UI behavior changes are shipped

## Security And Safety

- No shell interpolation. Use argument arrays.
- No frontend-supplied cwd.
- No arbitrary output path from frontend.
- No tmux pane id/pid/session persisted as Code Viewer authority.
- No secrets in docs, config, prompts, or generated artifacts.
- Generated artifacts must stay under `.codeviewer/annotated`.
- `tmux-adapter` `cwd_policy` remains the outer guardrail; Code Viewer path
  validation is the inner guardrail.

## Implementation Defaults And Remaining Checks

No product decision is currently blocking implementation.

V1 defaults:

- Completion model: submit-and-poll with generation-aware readiness.
  `annotation.generate` returns submission evidence; `annotation.status` proves
  the artifact belongs to the requested generation and passes validation.
- Artifact format: source-language fork under `.codeviewer/annotated/`, with
  inline comments and the original file extension preserved.
- Annotation Codex profile: use a small low-reasoning model by default. The
  current local runtime config uses `gpt-5.3-codex-spark` with
  `model_reasoning_effort=low`.
- Fast mode note: current local model metadata shows `gpt-5.3-codex-spark` and
  `gpt-5.4-mini` do not expose a Fast service tier. Do not claim this profile
  is in fast mode unless the live pane status proves it.
- Runtime events: no tmux-adapter output-event subscription in V1. Prove
  completion with file-level artifact evidence first.

Spec uncertainty sweep at 2026-05-21 08:05:

- No product or architecture decision is currently uncertain enough to block
  implementation.
- The earlier Markdown artifact wording was drift. The accepted product shape
  is `.codeviewer/annotated/{mirror-tree}` with original extensions preserved,
  so frontend syntax highlighting continues to use the normal `CodeBlock`.

Remaining implementation check:

- Re-check the live `tmux-adapter` CLI flags and JSON stdout shape before
  coding `tmux-adapter-client.ts`; this is tracked in
  [docs/todo.md](../todo.md).
