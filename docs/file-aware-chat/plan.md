# File-Aware Temporary Chat Plan

Created: 2026-06-01 22:22
Last Updated: 2026-06-02 00:17
Status: active plan; xhigh survey timed out, main-session recon integrated

## Goal

Add a lightweight temporary chat UI to Code Viewer's file view.

Initial behavior:

1. User opens a source file in Code Viewer.
2. User opens a small chat surface from the file toolbar/menu.
3. User asks a question.
4. Code Viewer automatically includes the current file content as context.
5. The question is sent to a Codex Spark target through the same
   `tmux-adapter ensure-target + send` pattern used by Code Annotation.
6. The answer is displayed in the frontend as a temporary conversation.

This is not meant to become a full persistent chat product in the first pass.
The first version should be a focused "ask about this file" tool.

## Current Baseline

Relevant Code Viewer pieces already available:

- `annotation.generate` / `annotation.status` shared protocol in
  `packages/shared/src/ws-types.ts`.
- `extension/src/providers/annotation-provider.ts` validates workspace-relative
  paths, derives workspace cwd from VS Code, calls `tmux-adapter`, and validates
  generated artifacts.
- `extension/src/providers/tmux-adapter-client.ts` already wraps
  `tmux-adapter ensure-target + send` and handles command parsing/fallback.
- `frontend/src/pages/files/code-viewer.tsx` already knows the active file,
  active workspace, current content, preview/non-preview state, and annotation
  UI phases.
- Backend relay already forwards unknown request/response message types and has
  annotation-specific debug log precedent in `backend/src/ws/relay.ts`.

Recent annotation commits:

- `ae05678 feat(annotation): add tmux adapter annotations`
- `876fcef fix(annotation): make generation status reliable`

## Product Boundary

In scope for V1:

- A temporary chat panel/drawer/sheet inside the file view.
- One active conversation per currently opened file path in frontend state.
- Prompt composer with submit, loading, error, and retry/resend affordance.
- Message rendering for user question and assistant answer.
- Automatic current-file context injection.
- A simple Codex Spark request using `tmux-adapter`.
- A dedicated Codex target/context via `codeViewer.fileChatSpawnProfile`
  (`code-viewer-codex-file-chat` by default). This must stay separate from
  annotation's `codeViewer.annotationSpawnProfile` so ad-hoc chat is not slowed
  or semantically polluted by long annotation prompts.
- Minimal run/debug metadata: generation/request id, binding id, target
  acquired state, elapsed time, and error message.

Out of scope for V1:

- Persistent chat history across app reloads.
- Multi-file retrieval or semantic search.
- Project-wide agent planning.
- Streaming UI unless it is almost free from the borrowed UI pattern.
- Editing files from the chat answer.
- Tool-call approval UI.
- Sharing chat sessions.

## Proposed Protocol

Add a new temporary chat domain instead of overloading annotation:

```ts
export const MSG_FILE_CHAT_SEND = 'fileChat.send' as const
export const MSG_FILE_CHAT_STATUS = 'fileChat.status' as const
```

Candidate payloads:

```ts
export interface FileChatSendPayload {
  path: string
  question: string
  requestId?: string
  includeCurrentFile?: true
  markedLines?: Array<{
    line: number
    content: string
  }>
}

export interface FileChatSendResultPayload {
  path: string
  requestId: string
  threadId: string
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
  manifestPath: string
  threadPath: string
  runLogPath: string
}

export interface FileChatStatusPayload {
  path: string
  requestId: string
  minUpdatedAt?: number
}

export interface FileChatStatusResultPayload {
  path: string
  requestId: string
  threadId: string
  ready: boolean
  state: 'pending' | 'ready' | 'invalid' | 'failed' | 'missing'
  manifestPath?: string
  threadPath?: string
  runLogPath?: string
  latestAssistantMessage?: string
  diagnostics?: string[]
  updatedAt?: number
}
```

Naming can change after the `shinyi-chat-ui` survey. The important boundary is:
chat gets its own protocol surface because its product behavior differs from
annotation artifacts.

## Runtime Shape

### Option A: Submit prompt and ask Codex to append to the thread artifact

This mirrors annotation most closely.

```text
frontend file chat submit
  -> backend relay
  -> extension file chat provider
  -> read current file content from workspace
  -> build temporary chat prompt
  -> tmux-adapter ensure-target with fileChat spawn profile
  -> tmux-adapter send
  -> Codex appends assistant block to .codeviewer/chat-runs/current/thread.md
  -> frontend polls fileChat.status
  -> frontend reads/displays latest assistant block
```

Large file-chat prompts can be tens of thousands of characters. The
tmux-adapter client should use a longer submit delay for large pasted prompts
so Codex does not receive an Enter key before the paste is fully settled.

Pros:

- Reuses annotation completion model.
- Easy to validate the latest assistant block belongs to the current request.
- Keeps a human-readable temporary conversation that can be manually or
  automatically archived without deleting context.
- Does not require parsing live tmux output.

Cons:

- No true streaming.
- Prompt must instruct Codex to append a structured assistant block.
- Slightly slower perceived response than streaming.

### Option B: Send prompt and capture tmux/adapter output

Pros:

- Better chat feel if `tmux-adapter` can expose output events.
- Could support streaming later.

Cons:

- More dependency on tmux-adapter event model.
- Higher risk for V1 because Code Viewer does not yet consume provider output
  as structured assistant messages.

Recommendation for V1: **Option A**. Treat file chat like an append-only
temporary conversation artifact first; revisit output streaming after the UX and
run log are stable.

## Prompt Contract

Initial prompt should be narrow and non-editing:

```text
You are answering an ad-hoc Code Viewer question about one file.

Workspace: <workspaceRoot>
Source file: <relativePath>
Thread file: .codeviewer/chat-runs/current/thread.md
Manifest file: .codeviewer/chat-runs/current/manifest.json
Run log: .codeviewer/chat-runs/current/run.jsonl
Request id: <requestId>

Rules:
- Read the current source file.
- Answer the user's question using this file as primary context.
- Prefer concrete references to functions, types, line-level behavior, and APIs.
- If the answer needs inference beyond the file, label it as Inference.
- Do not modify the source file.
- Do not modify files outside .codeviewer/chat-runs/current/.
- Append exactly one assistant block to the thread file.
- Use this header format: ## Assistant requestId=<requestId>
- Do not rewrite previous user or assistant blocks.
- Reply DONE with the thread path.

User question:
<question>
```

Open design point: whether to embed the current file content directly in the
prompt or require Codex to read the file. Embedding gives a stronger guarantee
that the "current file content" is exactly what the frontend saw, but it can
explode prompt size. For V1, extension should read the workspace file from disk
and include metadata; a later version can pass unsaved/dirty editor content if
needed.

## Frontend UI Sketch

V1 should use a summonable floating chat affordance rather than a permanently
visible panel.

Default collapsed state:

- A small circular floating button over the file viewer.
- The button can be dragged so it does not block the code currently being read.
- The last position can be kept in component state for V1; localStorage can wait
  until the behavior feels right.
- The button should show a subtle state indicator:
  - idle: neutral
  - waiting/running: spinner or pulsing ring
  - error: small red dot/ring
  - ready unread: accent dot/ring

Expanded state differs by viewport:

- Desktop/tablet: open a modest floating panel or right-side drawer sized for
  reading and typing without covering the whole code surface. It should be
  resizable later, but V1 can use a fixed max width/height.
- Mobile: open a full-screen chat view/sheet. A small overlay panel would fight
  the keyboard and code viewport; full-screen is more predictable and easier to
  read.

Likely minimal surface in `frontend/src/pages/files/code-viewer.tsx`:

- Add a floating `Ask About File` button.
- Keep the existing menu action as a secondary entry if it is cheap, but the
  floating button is the primary affordance.
- Open a desktop floating panel/right drawer or a mobile full-screen sheet based
  on viewport width.
- Components can be split out once shape is clear:
  - `FileChatFloatingButton`
  - `FileChatPanel`
  - `FileChatComposer`
  - `FileChatMessageList`
  - `FileChatStatusBadge`
  - `FileChatRunCard`

Line reference behavior:

- File bookmark and line reference markers are separate concepts.
- Bookmark becomes file-level only and lives under the `...` menu. It should not
  be created by clicking line numbers.
- Clicking a line number outside Step+ mode still shows the existing star-style
  line UI, but the semantic meaning is now "marked reference line for Ask About
  File", not a persisted bookmark.
- The chat composer should include a small icon button that inserts all marked
  reference lines into the prompt.
- Insert behavior should stay intentionally simple:

  ```text
  L12: <entire line content>
  L18: <entire line content>
  ```

- No ranges, no partial selection, no multi-step marker editing in V1. The line
  marker is only a convenient source for "insert this whole line with line
  number".

State model:

```ts
type FileChatPhase = 'idle' | 'submitting' | 'waiting' | 'ready' | 'error'

interface FileChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
}
```

V1 can keep messages in component state keyed by `workspace.extensionId + path`.
Do not persist to localStorage until product behavior is clearer.

Drag behavior:

- The collapsed button should remain inside the viewport after drag.
- On mobile, dragging should not interfere with vertical code scrolling; a small
  press-and-drag threshold is needed.
- When the chat expands, the collapsed position should not matter. Closing the
  panel returns to the floating button at its last safe position.

## Extension Slice

Add a separate provider:

```text
extension/src/providers/file-chat-provider.ts
```

Responsibilities:

- Validate workspace-relative `path`.
- Read the current file from workspace FS.
- Bound prompt size, with clear error if file is too large for V1.
- Create or update `.codeviewer/chat-runs/current/manifest.json`.
- Append a user block to `.codeviewer/chat-runs/current/thread.md`.
- Write structured events to `.codeviewer/chat-runs/current/run.jsonl`.
- Call existing `ensureTarget` and `sendMessage`.
- Implement `fileChat.status` by validating the latest assistant block freshness
  and reading that block back as the assistant message.

Keep shared code with annotation deliberate:

- Reuse `tmux-adapter-client.ts`.
- Consider extracting path helpers / artifact helpers only after duplication is
  visible.
- Do not fold file chat into `annotation-provider.ts`.

## Debug And Observability

File chat should reuse the planned annotation observability shape:

- `requestId` for each chat ask.
- `.codeviewer/chat-runs/current/run.jsonl`.
- Structured phases:
  - `frontend.fileChat.open`
  - `frontend.fileChat.submit`
  - `extension.fileChat.received`
  - `extension.fileChat.source.read`
  - `tmux.ensureTarget.done`
  - `tmux.send.done`
  - `extension.fileChat.status.pending`
  - `extension.fileChat.status.ready`
  - `frontend.fileChat.answer.loaded`
- UI should eventually expose `Copy Debug Info`.

This argues for implementing the observability backbone before or alongside the
file chat MVP, not after.

## Shinyi Chat UI Recon

An xhigh read-only subagent was spawned to survey:

```text
/Users/rickwen/code/shinyi-chat-ui
```

It did not return within a useful planning window and was closed. Main-session
recon used the canonical docs and primary code map instead:

- `/Users/rickwen/code/shinyi-chat-ui/docs/spec.md`
- `/Users/rickwen/code/shinyi-chat-ui/docs/code-map.md`
- `/Users/rickwen/code/shinyi-chat-ui/packages/chat-ui-core/src/types.ts`
- `/Users/rickwen/code/shinyi-chat-ui/packages/chat-ui-core/src/executor.ts`
- `/Users/rickwen/code/shinyi-chat-ui/playground/src/App.tsx`

### Findings

- `shinyi-chat-ui` is not primarily a chatbot widget. It is a reusable
  UI-facing action/protocol substrate for app workflows.
- The most relevant reusable ideas are headless contracts and state vocabulary:
  `PilotCurrentContext`, `PilotExpectedContext`, `PilotActionResult`,
  `PilotActionCardStatus`, source refs, anchors, action lifecycle statuses,
  and context mismatch protection.
- `playground/src/App.tsx` has a compact pattern worth imitating: local
  `ChatMessage[]`, local `ActionCard[]`, `runAction(...)` that stages
  `planning -> running -> result`, and explicit reset/error/confirmation demo
  states.
- The repo's production-facing value is not visual styling. It is the discipline
  of treating chat as a cockpit over app-owned context and actions.

### Reusable Pieces For Code Viewer

- **Message + action card split**: Keep user/assistant messages separate from
  run/status cards. For Code Viewer, a file chat ask can create:
  - one user message,
  - one assistant answer message,
  - one run card showing `submitting/waiting/ready/error`, target binding, and
    validation/debug info.
- **Context token mental model**: Code Viewer can define a lightweight file
  context token such as:

  ```text
  workspaceExtensionId:path:fileUpdatedAt:fileContentHash
  ```

  V1 may not need a full registry, but every chat request should record the file
  context it answered against.
- **Source refs / anchors**: Answers should eventually be able to point back to
  functions, line ranges, or symbols in the current file. V1 can start with
  plain text references, but the model should not block future anchors.
- **Action lifecycle vocabulary**: Use `planning/running/ok/failed/stale` style
  state names for debug and UI. This pairs well with the annotation
  observability plan.
- **Confirmation boundary**: Not needed in V1 because file chat is read-only,
  but the "chat cannot mutate app/domain state without app-owned action
  authority" invariant is worth preserving.

### Avoid Copying

- Do not copy the full `PilotToolFacade` / capability registry for V1. File
  chat initially has one implicit capability: "answer a question about this
  file".
- Do not copy WorkProof payroll examples or domain action handlers.
- Do not copy assistant-ui adapter assumptions unless Code Viewer explicitly
  adopts assistant-ui later.
- Do not import the package as a dependency yet. The conceptual overlap is
  useful, but Code Viewer currently needs a smaller, local, mobile-first panel.
- Do not implement `look/operate` or confirmation UI in V1. That would turn a
  temporary file Q&A feature into a broader agent cockpit too early.

### Adaptation Impact

The plan's earlier recommendation still stands, with a refinement:

- V1 should use artifact-poll transport through `tmux-adapter`, not live
  streaming.
- UI should include a small status/run card inspired by Shinyi Chat UI's
  `ActionCard`, not only a spinner.
- The request model should include a file context token, even if it only appears
  in debug output at first.
- Future versions can promote file chat into a richer `look`-style capability
  if Code Viewer gains source anchors or safe read-only tools.

## Milestones

### P0: Planning And Survey

- [x] Create this plan.
- [x] Integrate `shinyi-chat-ui` recon findings. The xhigh subagent timed out,
  so main-session recon is currently the planning baseline.
- [x] Decide V1 UI surface: draggable floating button; desktop expands to a
  modest floating panel/right drawer, mobile expands to full-screen chat.
- [x] Decide V1 answer transport: artifact-poll first, not live output.

### P1: Protocol And Provider Skeleton

- [ ] Add shared `fileChat.*` protocol types.
- [ ] Add extension handler registration.
- [ ] Add `file-chat-provider.ts` with path validation, prompt build, target
  ensure, send, and status.
- [ ] Add focused unit tests for path safety, prompt boundaries, status
  artifact validation, and missing answer behavior.

### P2: Frontend MVP

- [ ] Add file view menu/toolbar entry.
- [ ] Add `FileChatPanel` with message list, composer, submit state, and error
  state.
- [ ] Wire submit to `fileChat.send`.
- [ ] Poll `fileChat.status` and display answer when ready.
- [ ] Keep conversation temporary and file-scoped.

### P3: Runtime Verification

- [ ] Package/install VSIX.
- [ ] Restart VS Code extension host.
- [ ] Real WS smoke on a small file:
  - submit question
  - observe target spawned/reused
  - see pending then ready
  - answer loads in UI
  - source diff empty
  - `.codeviewer/chat-runs/current/thread.md` contains the matching assistant
    block
  - `.codeviewer/chat-runs/current/run.jsonl` contains the matching run events
- [ ] Mobile viewport screenshot check.

## Risks

- If Codex only writes artifact after a long delay, chat may feel sluggish.
- If the prompt embeds large file content, context and latency can degrade.
- If V1 reads from disk, unsaved VS Code buffer content will not be included.
- Sharing a Codex binding with annotation can preserve useful context, but can
  also carry stale conversation assumptions. V1 should make each prompt
  self-contained.
- Without run logs, chat failure will be hard to debug. Observability should not
  be postponed too far.

## Open Questions

- Should V1 include unsaved editor content, or only saved workspace file content?
- Should file chat reuse the annotation spawn profile exactly, or create a
  `code-viewer-codex-file-chat` profile with the same model?
- Should chat answers be plain Markdown artifacts or source-language comments
  when the question asks for explanation?
- Should one conversation reset on file navigation, or remain available when
  returning to the same file in the same browser session?
