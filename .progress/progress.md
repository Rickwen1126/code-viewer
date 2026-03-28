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

**State**: main branch, commit `d395055`. 196 tests pass. **E2E 39/40 PASS, 1 CONDITIONAL PASS, 0 FAIL.** 3 workspaces connected (code-viewer, chatpilot, warehouse-app).

**Next**:
- [ ] Verify on real iPhone after all E2E pass
- [ ] chatpilot integration
- [ ] 清理 E2E 過程中建的測試 tour（E2E Test Tour, Verified Tour, WS Switch Test）

**User Notes**:
- E2E 測試的核心教訓：之前的 E2E 連截圖都沒看，只看 accessibility snapshot 文字就標 PASS。debug log 加上後立刻抓到 5 個靜默失敗的 bug。三層 log 一致是驗證的最低標準。
- ws-client 不 reject error response 是根本性問題 — 所有前端 try/catch 都形同虛設。這個 fix 影響全局。
- E2E 調整方針已記錄於：(1) `.claude/skills/e2e-test/SKILL.md` — 40 項 checklist + pass criteria + 三層 log 驗證協議 (2) `CLAUDE.md` Testing section — E2E pass 標準 + debug mode 開關方式。兩處已同步。

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
