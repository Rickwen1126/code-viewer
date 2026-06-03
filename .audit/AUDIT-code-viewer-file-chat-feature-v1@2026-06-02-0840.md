# AUDIT: Code Viewer File-Aware Chat Feature

Created: 2026-06-02 08:40
Status: Needs Fix before stable
Scope: Ask About File / file-aware temporary chat feature across commits `7c0949e^..ce0653f`

## Verdict

The feature is usable for happy-path trials, but not yet stable enough to call done.

The important architecture direction is now right:

- file chat has its own shared `fileChat.*` protocol;
- extension uses a dedicated `codeViewer.fileChatSpawnProfile`;
- prompt no longer replays full source content;
- UI syncs from `.codeviewer/chat-runs/current/thread.md`;
- archive/new preserves old artifacts and attempts to destroy the old file-chat Codex target;
- assistant answers render Markdown.

The remaining risk is lifecycle correctness. A stale polling loop can still mutate the active UI after a user switches file, archives, or starts another flow. That explains the observed behavior where `thread.md` and the UI phase/error can disagree.

## Reviewed Surface

Commits:

- `7c0949e feat(file-chat): add file reference foundation`
- `5dad826 feat(annotation): add run debug logs`
- `72653a1 feat(file-chat): add provider protocol`
- `9657be5 feat(file-chat): add ask about file UI`
- `b394dc2 docs(file-chat): archive runtime verification`
- `5ba4aa7 fix(file-chat): isolate codex target`
- `b9e5a56 fix(file-chat): polish chat panel behavior`
- `9797ab6 feat(file-chat): sync UI with thread`
- `8318594 fix(file-chat): avoid replaying full source`
- `3b142e0 fix(file-chat): keep thread scrolled after file switch`
- `ce0653f fix(file-chat): tolerate late compacted replies`

Changed files: 19 files, roughly 3301 insertions.

CodeTour review: `.tours/review-file-chat-feature-20260602.tour`

## Blocking Findings

### 1. Stale poll can mutate active UI after archive/navigation

Location: `frontend/src/pages/files/code-viewer.tsx:1192`

`pollFileChatStatus()` starts a request-specific async loop, but it has no cancellation token or active request guard before mutating:

- `fileChatPhase`
- `fileChatError`
- `fileChatMessages`
- toast state

Impact:

If the user sends a question, clicks New/archive, switches file, closes/reopens, or otherwise changes context while the old poll is still alive, the old poll can later append an answer or set phase to `ready/error` for a stale request.

Fix:

Introduce an active request generation:

- `activeFileChatRequestRef.current = requestId` on submit;
- invalidate it on archive/new and optionally close;
- before each state mutation in `pollFileChatStatus`, return early if the request is no longer active;
- make timeout mutation conditional too.

This should be covered by a frontend unit test or Playwright smoke that simulates an archive while a pending request later resolves.

### 2. Timeout diagnostic is cleared by thread reload

Location: `frontend/src/pages/files/code-viewer.tsx:1247`

At timeout, the code sets a useful error message, then calls `await loadFileChatThread()`. `loadFileChatThread()` clears `fileChatError` on success at `frontend/src/pages/files/code-viewer.tsx:1260`.

Impact:

The UI can show only an `error` badge without the useful explanation. That weakens exactly the observability surface we added for this feature.

Fix:

Split thread loading from error clearing, or add `loadFileChatThread({ preserveError: true })` for timeout recovery.

### 3. Assistant parser can false-match quoted headers

Location: `extension/src/providers/file-chat-provider.ts:307`

`extractAssistantMessage()` uses `lastIndexOf(exactHeader)`. This can match a header string inside an assistant answer body, not only real line-start thread headers.

Impact:

`fileChat.status` can report `ready` with truncated/bogus content if Codex quotes the requested header in prose or code.

Fix:

Parse only real Markdown block headers with a multiline regex:

```ts
^## Assistant requestId=<escaped requestId>\s*$
```

Then slice until the next real line-start `## User requestId=` or `## Assistant requestId=` header. Add tests for:

- normal two-request extraction;
- compact duplicate recovery;
- quoted inline header should not be treated as a block header.

## Non-Blocking Findings

### 1. Feature plan has contract drift

Location: `docs/file-aware-chat/plan.md:16`

The Goal still says Code Viewer includes current file content as context, while the accepted decision later says not to paste the source file and to rely on workspace path plus marked lines.

This is not just wording. It is the exact drift that caused context-window exhaustion.

Fix:

Rewrite the Goal section to say the file is referenced by workspace-relative path, with optional marked lines. Move the old full-source idea to historical context or delete it from active requirements.

### 2. Plan milestones are stale

Location: `docs/file-aware-chat/plan.md:333`

P1/P2/P3 remain unchecked even though protocol/provider/UI/archive/runtime evidence exists.

Fix:

Archive completed plan items and leave only current gaps:

- stale poll cancellation;
- parser hardening;
- E2E coverage;
- docs/spec update.

### 3. Poll timing policy is hidden in magic numbers

Location: `frontend/src/pages/files/code-viewer.tsx:1193`

The loop uses `180`, `900`, `1500`, and `5000` inline.

Fix:

Extract named constants so timeout policy is visible and reviewable.

### 4. Prompt does not define compact/interruption recovery

Location: `extension/src/providers/file-chat-provider.ts:343`

The parser now tolerates late compacted replies, but the prompt does not tell Codex how to recover if a prior partial block exists.

Fix:

Add one explicit rule:

```text
If a partial/malformed assistant block for this request already exists, append one complete fresh block with the exact header. Do not edit earlier blocks.
```

## Contract / Learning Check

SHIP history: missing in repo-local `.ship/`.

Contract drift check: limited, using `docs/file-aware-chat/plan.md`, user decisions in the active session, and the implemented code.

Important accepted contracts:

- Syntax/API-first answers for junior engineers.
- No full-source replay in file-chat prompts.
- Dedicated file-chat Codex target, separate from annotation.
- UI follows durable `thread.md`; Codex session is not guaranteed to be perfectly synchronized with UI history.
- New/archive should reset UI artifacts and avoid reusing a stuck/context-overflowed file-chat session.
- Debug info should expose request id, thread path, run log path, file path, and target.

Drift:

- Code mostly follows the no-full-source and dedicated-target contracts.
- Docs still preserve older full-source language.
- Runtime lifecycle still lacks an active-request guard, so UI can temporarily contradict durable thread state.

## Evidence

Commands run:

```bash
pnpm --dir packages/shared exec vitest run src/__tests__/models.test.ts
pnpm --dir extension exec vitest run src/__tests__/file-chat-provider.test.ts src/__tests__/tmux-adapter-client.test.ts
pnpm --dir backend typecheck
pnpm --dir frontend typecheck
```

Results:

- shared protocol tests: 48 passed
- extension file-chat / tmux-adapter tests: 19 passed
- backend typecheck: exit 0
- frontend typecheck: exit 0

Not run in this audit:

- Playwright UI flow. This audit intentionally did not touch protected ports `4800` / `4801`.
- Live VS Code reload/runtime smoke after this audit report.

## Next Fix Order

1. Add active request generation/cancellation guard to `pollFileChatStatus()`.
2. Preserve timeout diagnostics when reloading `thread.md`.
3. Harden `extractAssistantMessage()` to parse real headers only.
4. Add unit tests for stale poll guard and parser false-positive cases.
5. Update `docs/file-aware-chat/plan.md` and `docs/todo.md` so active docs match the current implementation.
6. Run Playwright/visual verification after the fixes, with an explicit scenario: send question, switch file, switch back, archive/new, then confirm no stale request mutates the panel.

## Bank Handoff Candidates

- Durable learning: append-only artifact UIs need an active-request generation guard when the backend completion is asynchronous and slow.
- Debug model: UI history, artifact thread, and persistent Codex session are three different states; stable behavior requires making their sync boundaries explicit.
- Prompt design: "do not paste full source" must be reflected in top-level feature docs, not only buried in the prompt implementation.
