# Code Viewer — Completed Todo Archive

## Completed: File-Aware Chat Foundation @2026-06-01-2315

Section source:

- Plan: [docs/file-aware-chat/plan.md](./file-aware-chat/plan.md)
- Code/Surface: `frontend/src/pages/files/code-viewer.tsx`,
  `frontend/src/services/bookmarks.ts`
- User request: file-level bookmark under `...`; line-number stars become Ask
  About File reference markers; chat UI planning should use a draggable
  floating button on desktop/tablet and full-screen chat on mobile.

- [x] Created the file-aware chat planning folder and active plan entrypoint.
- [x] Integrated the `shinyi-chat-ui` recon conclusion: borrow message/action
  lifecycle ideas and source-anchor vocabulary, but keep Code Viewer V1 local,
  mobile-first, and artifact-poll based.
- [x] Updated the transport plan from one-off `answer.md` to append-only
  `.codeviewer/chat-runs/current/{manifest.json,thread.md,run.jsonl}` so the
  conversation can feel persistent, be manually archived, and retain useful
  context without deleting old answers.
- [x] Changed bookmarks to support file-level bookmarks while keeping legacy
  line bookmark reads compatible.
- [x] Changed file-view line-number click behavior outside Step+ mode from
  persisted bookmark creation to temporary Ask About File reference markers.
- [x] Kept `Copy Marked Lines` under the `...` menu as a lightweight utility
  for copying `L<line>: <content>` references before the chat composer exists.
- [x] Verification: `pnpm --dir frontend typecheck`.

## Completed: Annotation Run Event Logs @2026-06-01-2320

Section source:

- Spec: [docs/code-annotation-tmux-adapter/spec.md](./code-annotation-tmux-adapter/spec.md)
- Plan: [docs/file-aware-chat/plan.md](./file-aware-chat/plan.md)
- Code/Surface: `packages/shared/src/ws-types.ts`,
  `extension/src/providers/annotation-provider.ts`,
  `extension/src/__tests__/annotation-provider.test.ts`,
  `packages/shared/src/__tests__/models.test.ts`

- [x] Added a portable shared `RunEvent` shape for annotation and future file
  chat observability.
- [x] Added optional `runLogPath` to annotation generate/status payloads so UI
  and backend debug surfaces can point to the concrete run evidence.
- [x] Added annotation run log path derivation under
  `.codeviewer/annotation-runs/<generationId>/run.jsonl`.
- [x] Added extension-side JSONL event writes for annotation generate/status
  phases: received, validated, ensure-target start/done, spawn delay done, send
  start/done, status states, and error paths.
- [x] Run log events include request id, generation id, path, artifact path,
  target metadata when available, elapsed time, diagnostics, and concise error
  stack.
- [x] Verification: targeted Vitest
  `packages/shared/src/__tests__/models.test.ts` +
  `extension/src/__tests__/annotation-provider.test.ts`; monorepo
  `pnpm -r typecheck`.

## Completed: Annotation Debug Info Surface @2026-06-01-2322

Section source:

- Spec: [docs/code-annotation-tmux-adapter/spec.md](./code-annotation-tmux-adapter/spec.md)
- Plan: [docs/file-aware-chat/plan.md](./file-aware-chat/plan.md)
- Code/Surface: `frontend/src/pages/files/code-viewer.tsx`,
  `backend/src/ws/relay.ts`

- [x] Frontend now keeps latest annotation debug info with phase, state,
  generation id, submitted time, annotation path, run log path, target metadata,
  diagnostics, and error message when available.
- [x] Annotation status pill title includes the run log path when available.
- [x] File `...` menu now includes `Copy Annotation Debug Info`, disabled until
  a run/status event exists.
- [x] Backend annotation debug logging includes `runLogPath` in correlated
  request/response logs when `CODE_VIEWER_DEBUG=true`.
- [x] Verification: targeted Vitest
  `packages/shared/src/__tests__/models.test.ts` +
  `extension/src/__tests__/annotation-provider.test.ts`; monorepo
  `pnpm -r typecheck`.

## Completed: Code Annotation Reliability Infrastructure @2026-05-21-2355

Section source:

- Spec: [docs/code-annotation-tmux-adapter/spec.md](./code-annotation-tmux-adapter/spec.md)
- Code/Surface: `packages/shared/src/ws-types.ts`,
  `extension/src/providers/annotation-provider.ts`,
  `extension/src/__tests__/annotation-provider.test.ts`,
  `frontend/src/pages/files/code-viewer.tsx`,
  `frontend/src/__tests__/annotation-status.test.ts`, `backend/src/ws/relay.ts`
- Commit: `876fcef fix(annotation): make generation status reliable`

- [x] Made annotation readiness generation-aware so an old annotated artifact no
  longer makes a newer request look complete.
- [x] Added shared status fields for request correlation and frontend polling:
  `generationId`, artifact freshness, state, diagnostics, and generated path.
- [x] Hardened extension status validation around missing artifacts, stale
  artifacts, current-generation artifacts, and failed generation state.
- [x] Improved frontend annotation run handling so the UI polls the current
  generation, reports pending/ready/failed states accurately, and exposes
  better diagnostics when the provider cannot prove readiness.
- [x] Added focused tests for shared protocol shape, extension generation-aware
  status, frontend status handling, and backend relay behavior.
- [x] Verification included typechecks/tests, VSIX package/install smoke, and a
  real runtime smoke where an old artifact first reported pending for a new
  generation and then became ready only after the new artifact was written.

## Completed: Code Annotation MVP @2026-05-21-1110

Section source:

- Spec: [docs/code-annotation-tmux-adapter/spec.md](./code-annotation-tmux-adapter/spec.md)
- Handoff:
  [docs/code-annotation-tmux-adapter/handoff@2026-05-21-0716.md](./code-annotation-tmux-adapter/handoff@2026-05-21-0716.md)
- Code/Surface: `packages/shared/src/ws-types.ts`,
  `extension/src/providers/annotation-provider.ts`,
  `extension/src/providers/tmux-adapter-client.ts`,
  `extension/src/extension.ts`, `extension/package.json`,
  `frontend/src/pages/files/code-viewer.tsx`, `.gitignore`, `.codeviewer/`

- [x] Verified current `tmux-adapter` CLI contract and implemented a shell-free
  extension wrapper for `ensure-target` and `send`.
- [x] Implemented annotation WebSocket protocol and shared payload types:
  `annotation.generate`, `annotation.generate.result`, `annotation.status`,
  `annotation.status.result`.
- [x] Implemented extension-side annotation provider:
  workspace cwd comes from VS Code, source path is workspace-relative, generated
  artifact path was initially implemented as
  `.codeviewer/annotations/<relative path>.annotated.md`; this was later
  corrected back to the accepted source-language artifact shape
  `.codeviewer/annotated/<relative path>`.
- [x] Implemented frontend original/annotated toggle, annotation status pill,
  generate action, and menu-level `Regen Annotation`.
- [x] Added `.codeviewer/` to `.gitignore` and excluded it from file tree
  traversal.
- [x] Runtime smoke proved direct generation: Code Viewer submitted
  `annotation.generate` for `packages/shared/src/links.ts`, reused binding
  `codex:codex:2a8f950c606b`, and produced
  the initial Markdown artifact
  `.codeviewer/annotations/packages/shared/src/links.ts.annotated.md`.
- [x] Source integrity check: `git diff -- packages/shared/src/links.ts` was
  empty after annotation generation, proving the source file was not modified.
- [x] Playwright image analysis on iPhone viewport 390x844 verified original
  mode, the initial annotated Markdown mode, and the `Regen Annotation` menu.
  This visual evidence is superseded for content format by the later inline
  source-language correction. Screenshots:
  `/private/tmp/code-viewer-smoke/annotation-original.png`,
  `/private/tmp/code-viewer-smoke/annotation-annotated.png`,
  `/private/tmp/code-viewer-smoke/annotation-menu.png`.
- [x] Image analysis caught and fixed mobile toolbar overflow: annotation
  controls now stack within the header, and Playwright metrics ended at
  `scrollX=0`, `docScrollWidth=390`, `innerWidth=390`.
- [x] Verification commands completed: targeted Vitest for shared/extension
  annotation surfaces, `pnpm -r typecheck`, `pnpm -w run test`,
  `pnpm -r build`, extension VSIX package/install smoke, and post-visual-fix
  `pnpm --dir frontend typecheck`.

## Completed: Code Annotation Inline Source Correction @2026-05-21-2038

Section source:

- Spec: [docs/code-annotation-tmux-adapter/spec.md](./code-annotation-tmux-adapter/spec.md)
- Correction source: user caught PRD/spec drift; accepted behavior is annotated
  source code, not Markdown.
- Code/Surface: `extension/src/providers/annotation-provider.ts`,
  `extension/src/__tests__/annotation-provider.test.ts`,
  `packages/shared/src/__tests__/models.test.ts`,
  `docs/code-annotation-tmux-adapter/spec.md`, `.codeviewer/annotated/`

- [x] Corrected artifact path from `.codeviewer/annotations/*.annotated.md` to
  `.codeviewer/annotated/<relative path>`, preserving original file extension
  for Code Viewer syntax highlighting.
- [x] Corrected prompt contract: copy source file and add valid inline comments;
  do not wrap output in Markdown fences; do not modify the original source file.
- [x] Rebuilt and reinstalled VSIX, then reloaded the active VS Code extension
  host. Backend workspace evidence after reload:
  `extensionId=macbookm4pro-75296`, `extensionVersion=0.0.6`.
- [x] Live WS smoke proved spawn path for
  `packages/shared/src/links.ts`: result path
  `.codeviewer/annotated/packages/shared/src/links.ts`, binding
  `codex:codex:fc39d210a6e5`, `acquired=spawned`.
- [x] Live WS smoke proved reuse path for the same file and binding:
  `acquired=reused`.
- [x] Tmux pane evidence showed the annotation pane running
  `gpt-5.3-codex-spark low` and receiving the source-language inline-comment
  prompt.
- [x] File-level evidence confirmed the generated artifact is TypeScript with
  `//` Traditional Chinese inline comments, and `git diff --
  packages/shared/src/links.ts` remained empty.
- [x] Playwright iPhone screenshot verified Code Viewer displays the artifact
  as `links.ts` with `typescript`, line numbers, and Shiki `pre.shiki
  dark-plus` code highlighting. Screenshot:
  `/tmp/codeviewer-annotation-inline.png`.

## Completed: Code Annotation Runtime Refresh on 4801 @2026-05-21-2001

Section source:

- Spec: [docs/code-annotation-tmux-adapter/spec.md](./code-annotation-tmux-adapter/spec.md)
- Code/Surface: standard frontend runtime on reserved port `4801`
- User approval: direct request "直接全部重啟 4801"

- [x] Stopped stale `4801` frontend process pair:
  `pnpm --filter @code-viewer/frontend dev` parent pid `1940` and Vite child
  pid `1960`.
- [x] Restarted standard frontend with forced Vite refresh:
  `pnpm --dir frontend exec vite --host 0.0.0.0 --port 4801 --strictPort --force`.
- [x] Confirmed `4801` serves the updated transform containing
  `annotation.status`, `stackFileActions`, and `Regen Annotation`.
- [x] Playwright iPhone 390x844 smoke passed on
  `http://127.0.0.1:4801/files/packages/shared/src/links.ts`; it verified the
  annotation artifact, `Regen Annotation` menu, and no document-level
  horizontal overflow (`scrollX=0`, `docScrollWidth=390`, `innerWidth=390`).
- [x] Temporary verification frontend on `5174` was stopped after `4801`
  became current.

## Completed: WS Client Singleton Refactor @2026-05-07-0020

Section source:

- Spec: `docs/ws-client-singleton-refactor/problem.md`
- Plan: SHIP-driven
- Code/Surface: `frontend/src/services/ws-client.ts`
- SHIP: `.ship/SHIP-ws-client-singleton-refactor@2026-04-25.md`
- BANK: `.bank/BANK-004-ws-singleton-refactor-design@2026-04-25.md`
- CodeTour: `.tours/ws-client-singleton-refactor-20260507.tour`
- Review: `.tours/review-safari-zombie-ws-20260422.tour`

- [x] State machine rewrite（4 states × 4 events transition table）
- [x] Socket epoch for stale event rejection
- [x] setConnection 單一寫入入口
- [x] intentionalClose 取代 shouldReconnect
- [x] Code review fix: epoch++ before setConnection to prevent stale onclose flicker
- [x] E2E focused regression pass

## Completed: Semantic Location History @2026-04-13

Section source:

- Spec: `docs/semantic-location-history/spec.md`
- Plan: `docs/semantic-location-history/plan.md`
- Code/Surface: frontend routing, navigation state
- CodeTour: `.tours/05-semantic-location-history-code-viewer.tour`
- Review: `.tours/review-semantic-location-history-20260413.tour`
- Audit: `docs/semantic-location-history/cache-audit.md`

- [x] Phase 1: browser-history-correct semantic navigation
- [x] Phase 2: state cleanup（`.tours/07-phase2-state-cleanup-code-viewer.tour`）

This section was migrated from pre-rule todo files. Missing artifact links mean the original todo did not record those references, not that the new retention rule is optional.

## Completed: Demand-Driven Watch List @2026-04-11

Section source:

- Spec: `docs/demand-driven-watch-list/spec.md`
- Plan: `docs/demand-driven-watch-list/plan.md`
- Code/Surface: `extension/src/watch-registry.ts`, `backend/`, `frontend/`
- CodeTour: `.tours/04-demand-driven-watch-list-code-viewer.tour`
- Review: `.tours/review-demand-driven-watch-list-20260411.tour`

- [x] Frontend-derived watch list replaces activation-time eager watchers
- [x] Narrow live-watch scopes

This section was migrated from pre-rule todo files. Missing artifact links mean the original todo did not record those references, not that the new retention rule is optional.

## Completed: Safari Zombie WS Fix @2026-04-22

Section source:

- Spec: investigation-driven (no pre-spec)
- Code/Surface: `frontend/src/services/ws-client.ts`, Vite proxy config
- SHIP: `.ship/SHIP-safari-zombie-ws@2026-04-22.md`
- BANK: `.bank/BANK-003-safari-zombie-ws@2026-04-22.md`
- CodeTour: `.tours/fix-safari-zombie-ws-20260422.tour`, `.tours/backend-frontend-stale-detection-20260422.tour`
- Review: `.tours/review-safari-zombie-ws-20260422.tour`

- [x] Cross-port WebSocket bypass via Vite proxy
- [x] HTTP health probe + connect timeout
- [x] Backend/frontend stale detection

## Completed: Desktop UI @2026-04-13

Section source:

- Spec: `docs/desktop-ui/design@2026-04-13.md` (draft)
- Code/Surface: frontend responsive layout
- CodeTour: review tours from phase 1

- [x] Responsive shell: Activity Bar + resizable Sidebar + Main Content (>= 768px)

This section was migrated from pre-rule todo files. Missing artifact links mean the original todo did not record those references, not that the new retention rule is optional.

## Completed: Diff/Tour Step Links @2026-04-13

Section source:

- CodeTour: `.tours/06-diff-tour-step-links-code-viewer.tour`
- Review: `.tours/review-diff-tour-step-links-20260413.tour`

- [x] Git diff and tour step deep links

This section was migrated from pre-rule todo files. Missing artifact links mean the original todo did not record those references, not that the new retention rule is optional.

## Completed: Recent Fixes @2026-05-07

- [x] Markdown task list checkbox rendering (`1a368c8`)
- [x] Desktop file-browser-sidebar hook-order crash (`1bf7a85`)
- [x] Mobile file/git list scroll restoration (`ebcd837`)
- [x] Go-to-definition scroll preservation (`0c52a06`)
- [x] Tour navigation simplification (`01b3219`)

Source: migrated from `.progress/progress.md` sessions 2026-05-01 through 2026-05-07.
