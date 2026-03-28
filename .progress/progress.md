## 2026-03-29 00:27 — Edit-step title fix + targeted E2E regression + agent sync

**Goal**: Fix the `edit step` title-loss regression, align repo/global agent assets, and verify the fix with real E2E evidence

**Done**:
- Confirmed the real bug in [tour-detail.tsx](/Users/rickwen/code/code-viewer/frontend/src/pages/tours/tour-detail.tsx): edit flow deleted and re-added a step without preserving `step.title`
- Added [tour-detail-utils.ts](/Users/rickwen/code/code-viewer/frontend/src/pages/tours/tour-detail-utils.ts) and switched [tour-detail.tsx](/Users/rickwen/code/code-viewer/frontend/src/pages/tours/tour-detail.tsx) to use it so edited steps now preserve `title`, `selection`, `endLine`, and support context-only steps
- Added frontend regression test [tour-detail-utils.test.ts](/Users/rickwen/code/code-viewer/frontend/src/__tests__/tour-detail-utils.test.ts); also aligned [ws-types.ts](/Users/rickwen/code/code-viewer/packages/shared/src/ws-types.ts) and [tour-provider.ts](/Users/rickwen/code/code-viewer/extension/src/providers/tour-provider.ts)
- Verification passed:
  - `pnpm --filter @code-viewer/frontend exec vitest run src/__tests__/tour-detail-utils.test.ts`
  - `pnpm --filter code-viewer-extension exec vitest run src/__tests__/tour-provider.test.ts`
  - `pnpm -r typecheck`
- Ran `$reviewCode` + `$codetour`; generated:
  - `.tours/review-edit-step-boundary-20260329.tour`
  - `.tours/02-edit-step-boundary-code-viewer.tour`
- Repo-local agent assets synced: `.claude/skills/*` mirrored into `.agents/skills/*`; repo [AGENTS.md](/Users/rickwen/code/code-viewer/AGENTS.md) replaced with a direct copy of [CLAUDE.md](/Users/rickwen/code/code-viewer/CLAUDE.md)
- Corrected mistaken repo-local `.agent/` mirror to `.agents/`; also fixed global `sync-claude` to use `.agents/` in both chezmoi source and live `~/.codex`
- Global sync work done:
  - updated `/Users/rickwen/.codex/skills/sync-claude/SKILL.md` to ask scope first
  - merged chezmoi `dot_claude/CLAUDE.md` into `dot_codex/AGENTS.md` without overwriting Codex-only rules
- Fixed global `codeview-start` placement: installed the skill into the correct Codex target (`dot_codex/skills/codeview-start/SKILL.md` and `~/.codex/skills/codeview-start/SKILL.md`) and removed stray worktree copies
- Updated `.claude` and `.agents` skills:
  - [codeview-dev skill](/Users/rickwen/code/code-viewer/.claude/skills/codeview-dev/SKILL.md)
  - [e2e-test skill](/Users/rickwen/code/code-viewer/.claude/skills/e2e-test/SKILL.md)
  - Added explicit `--real` vs `lightweight` semantics, freshness check, and checklist item `26a` for preserving step title
- Built latest extension dist with one-off command because `pnpm --filter code-viewer-extension build` hit `sh: esbuild: command not found`:
  - `npx esbuild@0.25.11 extension/src/extension.ts --bundle --outfile=extension/dist/extension.js --external:vscode --format=cjs --platform=node`
- Launched real extension host with `node tests/e2e/launch-extension.mjs --real` after rebuild
- Added targeted Playwright regression [edit-step-title.mjs](/Users/rickwen/code/code-viewer/tests/e2e/edit-step-title.mjs) and ran it with escalation because sandboxed Chrome failed with `browserType.launch: Target page, context or browser has been closed`
- Final targeted E2E PASS:
  - script output: `uiBeforeSave=true`, `uiAfterSave=true`, `roundTrip=true`, `hasDeleteResult=true`, `hasAddResult=true`, `hasWsError=false`
  - frontend console artifact: `/tmp/code-viewer-e2e-edit-title-console.log`
  - screenshots visually checked: `/tmp/code-viewer-e2e-edit-title-after-save.png`, `/tmp/code-viewer-e2e-edit-title-roundtrip.png`
- `codeview-start` run completed with latest VSIX:
  - packaged + installed `code-viewer-extension-0.0.3.vsix`
  - fully quit and reopened VS Code so the new extension code actually loaded
  - connected workspaces: `code-viewer`, `notebooklm-controller-spec-architecture-rebaseline`, `chatpilot`, `warehouse-app-view-only-ui-20260329`
  - LAN URL confirmed: `http://10.0.4.5:4801`
- Added Tours list copy-path affordance in [frontend/src/pages/tours/index.tsx](/Users/rickwen/code/code-viewer/frontend/src/pages/tours/index.tsx): copy icon before each title, copies absolute `.tour` path, with toast feedback
- Fixed Git added-file rendering in [frontend/src/pages/git/diff-detail.tsx](/Users/rickwen/code/code-viewer/frontend/src/pages/git/diff-detail.tsx) and [frontend/src/pages/git/index.tsx](/Users/rickwen/code/code-viewer/frontend/src/pages/git/index.tsx): when status is `added` and `git.diff` returns no hunks, frontend falls back to `file.read` and synthesizes an all-added hunk via [diff-detail-utils.ts](/Users/rickwen/code/code-viewer/frontend/src/pages/git/diff-detail-utils.ts)
- Additional verification passed:
  - `pnpm --filter @code-viewer/frontend exec vitest run src/__tests__/diff-detail-utils.test.ts`
  - `pnpm --filter @code-viewer/frontend typecheck`

**Decisions**:
- `AGENTS.md` is for injected repo instructions, not a README/index; for this repo the safe default is to copy `CLAUDE.md`
- For code-viewer E2E that depends on extension/backend/LSP round-trip, prefer `tests/e2e/launch-extension.mjs --real`; lightweight mode is only for deliberate pure-frontend smoke checks
- Before trusting any E2E result, confirm the running extension host was launched after the latest `extension/dist/extension.js` build
- This regression deserves its own checklist item (`26a`), not just implicit coverage inside generic edit-step verification
- `codeview-start` must not install with `code-viewer-extension-*.vsix` wildcard; when multiple bundles exist it can reinstall an older VSIX
- After VSIX reinstall, do not claim "latest version connected" until VS Code has actually been reloaded or restarted
- The requested path `/Users/rickwen/code/code-view` did not exist; used `/Users/rickwen/code/code-viewer` as the closest intended repo during `codeview-start`

**State**: `main` at `de5cd8b`, dirty worktree. Current changed/untracked files include skill/docs sync work, `extension/src/providers/tour-provider.ts`, `frontend/src/pages/tours/*`, `frontend/src/pages/git/*`, `frontend/src/__tests__/*`, `packages/shared/src/ws-types.ts`, `tests/e2e/edit-step-title.mjs`, `.agents/`, `AGENTS.md`, and generated `.tours/*` files. VSIX `0.0.3` is installed and the requested 4 workspaces are connected. Targeted title-preservation E2E is green; full checklist was not rerun this session.

**Next**:
- [ ] Review/commit this cross-module milestone (`frontend + shared + extension + skill docs + tours`)
- [ ] Verify on real iPhone: Tours copy-path icon, edit-step title preservation, and Git added-file rendering
- [ ] Decide whether to tighten `TourAddStepPayload` into a union and de-duplicate the inline add-step payload type in `frontend/src/components/add-step-overlay.tsx`
- [ ] If needed, run broader `/e2e-test` coverage around #26 / #26a / #38a instead of only the targeted regression

**User Notes**:
- `AGENTS.md` should be treated as injection content, not LLM-readable index prose
- `$sync-claude` should first clarify scope: repo-local vs global, which assets to sync, and whether `CLAUDE.md -> AGENTS.md` is included
- During E2E, always check whether the already-running services/extension host are actually on the latest build before trusting results
- If `codeview-start` reinstalls the extension, fully killing/reopening VS Code is acceptable when needed to guarantee the latest extension code is active

## 2026-03-28 22:14 — CodeTour recording implementation + E2E overhaul + 7 bug fixes

**Goal**: Implement CodeTour recording UI, fix bugs found during strict E2E testing, overhaul E2E skill with three-layer log verification

**Done**:
- CodeTour recording UI: TourEditContext, + New Tour, Step+ toggle, AddStepOverlay (Screen 1/2), tour detail Edit/Delete/+ Add step after, empty tour UI, Tours list editing indicator + Done
- 7 bugs fixed during E2E:
  1. 0-step tour crash (`tourData.steps` undefined) — defensive `?? []`
  2. Step+ toggle destroyed reference point — changed to local `stepModeActive`
  3. Tours list Edit button was per-tour not per-step — removed, added Done button
  4. Backend `status !== 'recording'` blocked addStep/deleteStep on existing tours — removed check
  5. Backend `TOUR_RECORDING_EXISTS` blocked tour.create — removed check
  6. ws-client resolved `.error` responses instead of rejecting — now rejects
  7. ws-client didn't catch generic `type: 'error'` relay responses — added check
- Debug mode logging: frontend `[ws]` (localStorage toggle), backend `[relay]` (env var), extension `[CodeViewer]` (VS Code setting)
- E2E skill rewritten: 40 test items, strict pass criteria (UI + console log + round-trip), three-layer verification

**Decisions**:
- Reference point cleared only by: Done button (Tours tab) or workspace switch. NOT by tab switch or Step+ toggle.
- E2E pass = console shows `.result` (not `.error`) + UI correct + round-trip persists. Never pass on snapshot text alone.
- Debug mode per-layer: `code-viewer:debug` localStorage, `CODE_VIEWER_DEBUG` env, `codeViewer.debug` VS Code setting

**Done** (continued):
- Bug #8: edit context-only step (no file/line) — backend addStep file now optional, frontend handles missing file
- Bug #9: edit/delete error replaced entire page — changed to toast (3s auto-dismiss, red for errors)
- End line UX: text input (allows clear/retype), empty=same as start, validation on Next, Auto button (lsp.documentSymbol)
- Workspace highlight: selected workspace has blue border on Workspaces page
- Workspace name: shown in Files toolbar row next to Collapse All
- VSIX rebuilt to 0.0.2, installed to all workspaces
- E2E checklist expanded to 47 items (#18a-d end line, #38a context edit, #41-#43)
- Test tours cleaned up (E2E Test Tour, Verified Tour, WS Switch Test removed)

**State**: main branch, commit `d194e7f`. 196 tests pass. **E2E 47/47 items verified.** 3 workspaces connected. VSIX 0.0.2 deployed.

**Next**:
- [ ] Fix: edit step 丟了 `title` field（addStep payload 沒傳 step.title）— Sky Eye tour step 1 已用 git checkout 還原
- [ ] Verify on real iPhone
- [ ] chatpilot integration

**User Notes**:
- E2E 測試的核心教訓：之前的 E2E 連截圖都沒看，只看 accessibility snapshot 文字就標 PASS。debug log 加上後立刻抓到 5 個靜默失敗的 bug。三層 log 一致是驗證的最低標準。
- ws-client 不 reject error response 是根本性問題 — 所有前端 try/catch 都形同虛設。這個 fix 影響全局。
- E2E 調整方針已記錄於：(1) `.claude/skills/e2e-test/SKILL.md` — 47 項 checklist + pass criteria + 三層 log 驗證協議 (2) `CLAUDE.md` Testing section — E2E pass 標準 + debug mode 開關方式。兩處已同步。
- Edit step 有 side effect：delete+re-add 時沒保留原 step 的 `title` field，也會把 context step 加上空 `file: ""`。下個 session 要修。
- alert() 在手機上會彈系統對話框（顯示 domain + "禁止顯示對話方塊"），所有 validation/error 都該用 inline message 不用 alert。

## 2026-03-28 16:24 — Frontend features + session resilience bug + CodeTour polish + recording design

**Goal**: Implement 4 frontend features, fix reconnect bug, polish CodeTour viewing, design recording UI

**Done**:
- Feature 2: Session resilience — auto-restore last file, persist wrap/scroll/font-size, per-workspace current-file key
- Feature 1: Markdown preview — `marked` lexer + custom React renderer, Raw/Rendered toggle
- Feature 4a: In-file search — search bar, instant highlight, prev/next, match count
- Feature 3: Bookmarks — single-tap line number, gold ★ gutter, header badge, browser list
- Header: two-row layout (filename + metadata/buttons)
- E2E: 8 → 12 items, "run /e2e-test after new features" rule
- CodeTour viewing polish: selection highlight, getFileAtRef, MarkdownRenderer descriptions, line number offset, scrollToLine
- WS reconnect race condition fix: `else if (res.payload.content)` guard
- CodeTour recording UI design completed — plan written to `docs/superpowers/specs/2026-03-28-codetour-recording-plan.md`

**Decisions**:
- Feature 4b (grep) dropped — low ROI for mobile review
- Markdown rendered mode: no line numbers/bookmarks (source ≠ rendered)
- Bookmark: single-tap line number, not long-press
- **CodeTour recording: no recording mode** — just a reference point (tourId + afterIndex). Each step immediately persisted via WS. Frontend owns only the pointer, backend owns the data.
- Step+ toggle in header: OFF = bookmark, ON = add step to tour
- Full-screen overlay for step input
- No preview needed (structured markdown editor)
- Edit step = description only, not file/line
- No reorder (API doesn't support, nice-to-have)

**State**: main branch, commit `c37cd1c`. 196 tests pass. E2E verified.

**Next**:
- [ ] Implement CodeTour recording per plan doc
- [ ] Verify session resilience + bookmark on real iPhone
- [ ] chatpilot integration

**User Notes**:
- Race condition cascade: race → optimistic overwrite → cache poisoning → self-reinforcing loop (note saved)
- Recording 設計核心洞察：每步即存 = backend 隨時有完整資料 = 不需要 recording mode / finalize / crash recovery / offline queue。前端只持有一個 pointer。
