## 2026-03-21 12:05 — AUDIT complete + 4 quick fixes queued

**Goal**: 實作 Mobile Code Viewer 全部 6 個 User Stories + 測試 + code review + security fixes + AUDIT

**Done**:
- Phase 1-8 實作 + 166 tests + 8 critical fixes（commits: `5605bb1`, `4ab3776`, `1389c76`）
- AUDIT v1 完成：`.audit/AUDIT-002-mobile-viewer-v1@2026-03-21.md`
  - 判定：需修正（minor），不阻擋進 BANK
  - 8 個 Exit Questions 全部走完，learning notes 記錄在 `.audit/learning-notes.md`
- Sky Eye tour 走完（Rick 手機上逐步 review）
- Copilot Chat session spike 完成：`.jsonl` 可解析，329 sessions found，格式 event-sourced log
- AUDIT learning notes 記錄了 5 個可操作的發現（A2-1, A2-3, A2-4, C2, C3, C5）

**Decisions**:
- Path traversal 修法選 B：允許 workspace 內 + VS Code 有開的檔案
- Auth 用 shared secret 最小方案
- A2-1 Backend relay 長期應升級為 session broker（transport/session 分離）— 超出 MVP
- A2-3 Copilot Chat session `.jsonl` 讀取技術可行，留到後續 feature
- Map 遍歷 delete 雖然 JS 安全但應改為防禦性寫法（可讀性原則）

**State**: Branch `002-mobile-viewer`, 3 commits. AUDIT + learning notes + spike 結果尚未 commit。
166 tests passing, 4 packages typecheck clean.

**Next**:
- [ ] 修 4 個 AUDIT 發現（dispatch table + error 兜底、Map 批次 delete、timeout has() 防護、relay timestamp log）
- [ ] Phase 9 Polish（T064-T070）

**User Notes**:
- Path traversal 用 B 方案 — 因為需要看 package dependency 跟外部 lib
- Map 遍歷 delete「像把人綁在懸崖旁邊說很安全」— 要改為防禦性寫法
- C2 error 兜底 + C5 timestamp log 值得修，effort 小效果大
- 先 save 然後修正 4 個 AUDIT findings

---

## 2026-03-16 22:15 — analyze complete + SHIP knowledge review done

**Goal**: Cross-artifact analysis + 技術知識確認，準備開工實作

**Done**:
- `/speckit.analyze` 完成：15 findings（6 HIGH, 6 MEDIUM, 3 LOW），14 已修正
- Commit `ed5b118`: docs: apply cross-artifact analysis fixes (14 of 15 findings)
- Key fixes:
  - 移除 `workspace.info` 訊息 + `workspaceInfoCache`（被 connection.* 覆蓋）
  - 移除 Frontend `jsdiff` 依賴（diff 由 Extension 預算）
  - 移除 `@tanstack/react-virtual`（MVP 不做虛擬化）
  - 大檔案 >5MB 顯示外殼不載入（改寫 spec edge case）
  - MVP 用 `react-shiki`（T033 虛擬化移除，記為 known issue）
  - 4 個 event handler 折進頁面 task（T030/T032/T044/T049）
  - 新增 T070 Playwright E2E 驗證 SC-001~SC-007
  - `chat.send` 加上 `'plan'` mode
  - React 版本 19 → 19.2+
- SHIP 知識確認完成（`.ship/SHIP-002-mobile-viewer@2026-03-15.md`）
  - B1 VS Code Extension API 委託模型 ✅
  - B2 Hono WS relay 架構 ✅
  - B3 WebSocket 訊息路由 ✅
  - R1-R5 專案特有技術 ✅
  - R6-R13 基礎技術 ✅

**Decisions**:
- 大檔案策略：>5MB 顯示外殼 + 提示「請在 Desktop 查看」，不做分段載入
- MVP 不做虛擬化：react-shiki 整塊渲染，1000+ 行可能卡頓（known issue）
- WS 重連策略：Extension 端 exponential backoff（1s→2s→4s...cap 60s）無限重試
- F15 跳過：tasks.md 英文描述比中文更實用

**State**: Branch `002-mobile-viewer`, clean working tree.
Latest commit: `ed5b118 docs: apply cross-artifact analysis fixes (14 of 15 findings)`
SHIP 狀態：可開工。tasks.md 現在 68 tasks（T033 移除，T070 新增）。

**Next**:
- [x] Run `/speckit.implement` to begin Phase 1 Setup (monorepo init)

**User Notes**:
- 開工

---

## 2026-03-14 21:02 — speckit.plan + tasks complete for 002-mobile-viewer

**Goal**: Complete speckit workflow (spec → plan → tasks) for Mobile Code Viewer feature

**Done**:
- Renamed branch `001-mobile-viewer` → `002-mobile-viewer`, deleted old branch
- Renamed spec dir `specs/001-mobile-viewer/` → `specs/002-mobile-viewer/`, updated all internal refs
- Cross-referenced plan artifacts vs data-model, fixed 10 inconsistencies:
  - ER diagram 1:N → 1:1 (ExtensionConnection-Workspace)
  - Unified `workspacePath` → `rootPath` across data-model + message-types
  - Added stale → removed 5min timeout in state machine + ws-protocol
  - Added FrontendSession entity, workspaceInfoCache to backend state
  - Added git-status to frontend IndexedDB cache
  - ChatSession.mode: added `'plan'` (data-model + message-types 3 places)
  - CodeTour: changed to read-only, removed annotations from spec US6
  - Removed redundant `filePath` from review.getEditDiff.result
  - Aligned research.md heartbeat (10s → 40s) with final protocol
- Generated `tasks.md`: 69 tasks across 9 phases (MVP = Phase 1-3, 35 tasks)

**Decisions**:
- CodeTour is read-only on mobile (matches VS Code behavior, avoids editing `.tour` JSON pain)
- ChatSession.mode includes 'plan' alongside 'ask' and 'agent'
- Worktree `002-mvp-v2` now on branch `002-mobile-viewer` (was `001-mobile-viewer`)

**State**: Branch `002-mobile-viewer` in worktree `.worktrees/002-mvp-v2`, clean working tree.
Latest commit: `1b913c7 docs: generate tasks.md and rename spec dir to 002-mobile-viewer`

**Next**:
- [x] Run `/speckit.analyze` for cross-artifact consistency check before implementing
- [x] Run `/speckit.implement` to begin Phase 1 Setup (monorepo init)
