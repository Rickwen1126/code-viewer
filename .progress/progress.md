## 2026-03-21 20:51 — Cache-first + PWA + language mapping + UX issues

**Goal**: Post-MVP polish — code review fixes, UX improvements, E2E validation, mobile live testing

**Done**:
- 6/8 code review items fixed (dispatch table + error response already existed)
  - debounce onDidChangeTextDocument, filter node_modules/.git events
  - dedup payload types with models, pendingRequests drain on WS close
  - backend graceful shutdown (SIGTERM/SIGINT), wsClient.connect() idempotent guard
- Skeleton loading UI replacing plain "Loading..." text
- Ports changed: backend 3000→4800, frontend 5847→4801
- Performance audit: Shiki 57KB gzip (PASS <135KB), manualChunks split
- QUICKSTART.md created, CLAUDE.md updated with ports/commands/testing
- E2E infrastructure: @vscode/test-electron + Playwright (3 modes: lightweight/real/copilot)
- E2E validated: SC-001/002/005/007 PASS, SC-003/004 CONDITIONAL (test VS Code env)
- .vscode/launch.json for Extension F5 debugging
- Bug fix: CodeBlock crash on undefined code (direct URL navigation)
- Horizontal scroll (default) + word-wrap toggle button
- Fix nested <pre> causing double-click-selects-all (as="div" + addDefaultStyles=false)
- Fix double line spacing (removed .line display:block conflicting with <pre> newlines)
- Remove touch handlers from code area — native text selection works on mobile
- Sourcegraph-style tap-to-popover: tap code → popover with hover info + Definition/References
  - Uses caretRangeFromPoint for precise line/character from tap coordinates
- WS URL auto-derives from window.location.hostname (mobile LAN/Tailscale works)
- Safari background WS kill → instant reconnect via visibilitychange listener
- Direct URL navigation → redirect to /workspaces when no workspace selected
- Backend broadcasts connection.extensionConnected to ALL frontends (was missing)
- Workspace page: spinner states, live event updates, no manual refresh needed
- Wrap-mode line numbers: Shiki transformer injects data-line attribute → CSS attr(data-line)
- Wrap-mode wrapped text alignment: flex-column on <code> + display:block on .line
- Go to Definition highlight: target line blue fade animation 3s
- Extension smoke test timeout: 5min → 30min

**Decisions**:
- E2E --real mode uses installed VS Code + user extensions (TS/LSP works)
- E2E --copilot mode needs user VS Code closed (shares user-data-dir)
- Playwright tests must use iPhone viewport 390x844
- Shiki transformer for line numbers > CSS counter (always correct, no counting bugs)
- Tap-on-code popover > long-press action sheet (doesn't conflict with native selection)

**State**: main branch, commit `5eba457`. 166 tests pass, typecheck clean.
Backend :4800 + Frontend :4801 running. Extension via @vscode/test-electron --real (30min timeout).

**Done** (cache-first segment):
- Cache-first: 7 files (cache.ts, use-workspace, connection-status, workspaces, file-browser, code-viewer, git)
- IndexedDB v2: added workspaces store
- Workspace persisted in localStorage (survives reload)
- Red "Disconnected" banner → subtle 3px bar
- Workspace auto-rebind on reconnect (selectWorkspace sent automatically)
- Playwright E2E verified: cold start auto-update, reload, all pages pass

**State**: main branch, commit `e215cc7`. 166 tests pass, typecheck clean.

**Done** (late segment):
- VS Code → Shiki language mapping (4 hard + 11 internal IDs)
- PWA setup: manifest link, apple meta tags, SVG icon, Service Worker, SW registration
- README: iCloud Private Relay warning + Safari background WS known issues
- Spec updated: cache-first FRs, tap popover gesture, connection status bar

**State**: main branch, commit `ff80ce1`. 166 tests pass. Production build on :4802.

**Next**:
- [ ] File tree UX (P0):
  - 點擊檔案後 tree 不見，要靠 back/icon 回來
  - 返回 tree 時重 load，不保留展開狀態
  - 換檔案不 focus 在該檔案的 tree 位置
  - 展開/收合沒有記憶
  - 沒有一鍵收合功能
- [ ] 搜尋檔案功能（類似 VS Code Cmd+P）:
  - 輸入檔名即時 fuzzy match
  - 從 cached file tree 搜尋，不需要 WS
  - 點擊結果直接開檔案
- [ ] Chat Copilot 對話 session 延續:
  - 手機上看到 Desktop 的既有 chat sessions
  - 接續對話，不只是開新的
- [ ] CodeTour view 修正:
  - Markdown 沒有 render，純文字擠在一起
  - 可以跳轉到 file 但無法一鍵回到 tour 對應步驟
  - 返回 tour 從 list 頭開始，不保留瀏覽狀態
- [ ] **P0 嚴重 BUG**: 手機換 app 再回來 → 畫面全灰，UI 完全消失
  - 重新整理也沒用
  - 要手動刪 URL path 回首頁才恢復
  - 影響所有頁面（files/git/tour/chat/review）
  - 可能是 Safari background suspend + React state 丟失
- [ ] 最近瀏覽檔案 list:
  - Files icon 長按 → popup 顯示 recent files
  - 從 cache 讀取已瀏覽過的檔案清單
- [ ] Tab bar 整合: Chat + Review 合併為 "Copilot"
  - 點擊 → Chat（對話）
  - 長按 → popup 選 Chat / Edit Review
  - 減少 tab 數量，關聯功能不拆開
- [ ] Application-level heartbeat（Safari onclose bug workaround）
- [ ] PWA standalone 問題（加分，不急）:
  - 頂部 UI 被 status bar 蓋住
  - 底部 tab bar 離底太遠
  - 獨立 storage context，每次 cold start
- [ ] File tree lazy load
- [ ] 離線瀏覽已 cache 的檔案（local path）

**User Notes**:
- iCloud 私密轉送是 Safari WS 連不上的 root cause（已寫入 README）
- PWA 是加分不急，瀏覽器版先做好
- File tree 狀態管理是下個重點

## 2026-03-21 14:37 — MVP v1 merged to main, SHIP/AUDIT/BANK complete

**Goal**: Mobile Code Viewer MVP — 全部 User Stories 實作 + 測試 + review + 修正 + merge

**Done**:
- Phase 1-8 全部實作（66/69 tasks）+ Phase 9 T064-T067 polish
- 166 unit tests, 8 critical security fixes, 4 AUDIT findings fixed, 3 runtime bugs fixed
- AUDIT v1 + 8 Exit Questions 走完
- BANK v1 + 4 心智模型 + 3 runtime findings
- Spec/plan 比對完成，baseline 存為 `specs/spec-mvp.md` + `specs/plan-mvp.md`
- Branch `002-mobile-viewer` merged to main: `a07caf5`
- BANK prompt 改版：存 `.bank/` 進 git，加心智模型 + runtime findings

**Decisions**:
- Path traversal 用 B 方案（允許 workspace 內 + VS Code open docs）
- Backend relay 長期應升級為 session broker — 超出 MVP
- Copilot Chat `.jsonl` 讀取技術可行（spike 驗證），留到後續 feature
- `@vscode/test-electron` 做 Extension E2E

**State**: main branch, commit `a07caf5`. 166 tests, typecheck clean.
Worktree `.worktrees/002-mvp-v2` 可清理或保留。

**Next**:
- [ ] T068 Performance audit（Shiki bundle size, 大檔案壓測）
- [ ] T069 Quickstart.md end-to-end 驗證
- [ ] T070 E2E with `@vscode/test-electron`
- [ ] Copilot Chat session 歷史讀取（`.jsonl` parser）
- [ ] 15 個 code review suggestions
- [ ] Skeleton loading + showLineNumbers
