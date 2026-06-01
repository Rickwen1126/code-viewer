# Code Viewer — Active Todo

## P1: Annotation And Chat Observability @2026-06-01-2315

Section source:

- Spec: `docs/code-annotation-tmux-adapter/spec.md`
- Plan: `docs/file-aware-chat/plan.md`
- Code/Surface: `extension/src/providers/annotation-provider.ts`, future `extension/src/providers/file-chat-provider.ts`, `backend/src/ws/relay.ts`, `frontend/src/pages/files/code-viewer.tsx`
- User request: frontend and backend/extension debug logs must expose dataflow and call stack enough to diagnose failed annotation/chat runs.

- [ ] Define shared run-event schema for annotation and file chat
  - Code: `packages/shared/src/ws-types.ts`
  - Acceptance: both features can report request id, workspace id, source path, artifact/thread path, target binding, phase, elapsed time, and structured diagnostics without scraping console text.
- [ ] Add extension-side JSONL run logs
  - Code: `extension/src/providers/annotation-provider.ts`, future `extension/src/providers/file-chat-provider.ts`
  - Acceptance: every generate/ask request writes deterministic phase events to `.codeviewer/*/run.jsonl`, including path validation, source read, ensure-target, send, status poll, ready/failed state, and concise error stack.
- [ ] Add frontend/backend observable debug surface
  - Code: `frontend/src/pages/files/code-viewer.tsx`, `backend/src/ws/relay.ts`
  - Acceptance: UI can expose Copy Debug Info for the latest run; backend relay logs include request/response correlation in debug mode without leaking full source content by default.

## P1: File-Aware Chat MVP @2026-06-01-2315

Section source:

- Plan: `docs/file-aware-chat/plan.md`
- Code/Surface: `packages/shared/src/ws-types.ts`, `extension/src/providers/file-chat-provider.ts`, `extension/src/extension.ts`, `frontend/src/pages/files/code-viewer.tsx`

- [ ] Add `fileChat.*` protocol and extension provider
  - Plan: `docs/file-aware-chat/plan.md`
  - Acceptance: frontend can submit a question for the current file; extension creates/updates the thread artifacts, sends a self-contained Codex Spark prompt through `tmux-adapter`, and status can validate the latest assistant append.
- [ ] Build draggable Ask About File UI
  - Code: `frontend/src/pages/files/code-viewer.tsx`
  - Acceptance: desktop opens an appropriately sized floating panel or drawer; mobile opens a full-screen chat sheet; composer includes an icon button that inserts all marked reference lines as simple `L<line>: <content>` text.
- [ ] Runtime verification with visual and data-level evidence
  - Acceptance: real VSIX/runtime smoke shows submit -> target spawned/reused -> pending -> ready -> answer displayed; `.codeviewer/chat-runs/current/thread.md` and `run.jsonl` contain the expected request; source diff remains empty; Playwright screenshots verify desktop/mobile layout and no overlap.

## P1: Known Improvements @2026-05-12-1635

Section source:

- Spec: various, accumulated from progress sessions
- Code/Surface: mixed

- [ ] PWA fix: PNG icons, apple-touch-icon, manifest scope, SW cache versioning
  - Code: `frontend/public/`, `frontend/index.html`
  - Source: migrated from legacy todo; original source refs were not recorded
- [ ] File tree lazy load — 只載入當前展開層，展開時 fetch children
  - Code: `extension/src/providers/file-provider.ts`, shared `FileTreeNode`, frontend file tree
  - Source: `docs/archive/2026-04-23.md`
- [ ] Go to definition 外部檔案存取（受控放寬）
  - Code: `extension/src/providers/lsp-provider.ts`
  - Source: migrated from progress.md; original source refs were not recorded

## P2: Infrastructure @2026-05-12-1635

- [ ] Production reverse proxy 設定
  - Source: migrated from legacy todo; original source refs were not recorded

## P1: HTML Rendered Toggle Preview @2026-05-31-1456

Section source:

- Plan: `docs/html-rendered-toggle-preview/plan.md`
- Code/Surface: `frontend/src/services/file-location.ts`, `frontend/src/pages/open/open-file.tsx`, `frontend/src/pages/files/code-viewer.tsx`, `packages/shared/src/file-preview.ts`, `extension/src/providers/file-provider.ts`

- [ ] Add explicit `Source / Rendered` toggle for eligible HTML architecture artifacts under `/files/*`
  - Plan: `docs/html-rendered-toggle-preview/plan.md`
  - Code: `frontend/src/services/file-location.ts`, `frontend/src/pages/open/open-file.tsx`, `frontend/src/pages/files/code-viewer.tsx`
  - Follow-up: Phase 1 stays frontend-only; do not broaden shared `file.preview` protocol unless generic HTML preview becomes a separate requirement

## Backlog @2026-05-12-1635

- [ ] Extension Copy Mobile Link command
  - Source: `docs/archive/2026-04-13.md` — deferred, backend/CLI deep-link surface 已可用
  - Follow-up: reconcile this item into the relevant spec/plan before implementation
