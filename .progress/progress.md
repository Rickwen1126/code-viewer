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

**Done** (production features):
- P0 gray screen fix: Error Boundary + zombie WS detection on visibilitychange
- File search: fuzzy match from cached tree, sticky search bar, 20 results max
- Recent files: localStorage 最近 15 個, search bar focus 時顯示
- Copilot #file reference: auto-attach current file, removable chips UI
- Chat mode switch: Ask/Plan toggle in context bar
- Chat conversation history: sends last 10 turns for context continuity
- chat.listModels: extension handler returns available LM models
- VS Code → Shiki language mapping: comprehensive 15-entry table

**State**: main branch, commit `38fd2cf`. 166 tests pass, typecheck clean.

**Next**:
- [ ] 接入 chatpilot（~/code/chatpilot）替換 vscode.lm：
  - chatpilot 是 channel-agnostic AI agent gateway（FastAPI + Copilot SDK）
  - 有完整 session management、tool registry、routing
  - 整合方式：Backend 加 chatpilot adapter，或直接 HTTP 呼叫
  - Chat UI/UX 保留，只換 backend 實作
- [ ] Model selector UI（前端 dropdown，等 chatpilot）
- [ ] **CodeTour Record + Edit（新 feature）**:
  - Code view 加 "+" 按鈕 → 填 tour name → 進入 record 模式（auto commit tracking）
  - Record 模式：行號可點擊 → popup 輸入視窗
  - 固定 markdown 格式：## 標題 + 內文，可無限加多組
  - Action "Tour Record Done" 跳離 record（confirm dialog）
  - 斷線也維持 record 狀態（browser local state）
  - Record 中可在 Tour tab preview
  - 編輯模式：每個 tour item 可 "append" 新項目（同 record 格式）
  - 不提供編輯已存資料、不提供 re-order nodes
  - Tour 觀看：如果 commit 不對應 → 提示切 commit（stash → checkout）
  - 看完最後一個 → 恢復原 commit + stash pop
- [ ] **Git 功能強化**:
  - Staged vs unstaged 分開顯示
  - Branch 資訊顯示（目前沒有顯示在哪個 branch）
  - Commit history / log
  - Branch 切換
  - Stash 管理
  - （Tour 完工後再討論細節）
- [ ] File tree UX:
  - 展開狀態記憶、focus 到當前檔案、一鍵收合
- [ ] Tab bar 整合: Chat + Review → "Copilot"
- [ ] CodeTour markdown render + 狀態保留
- [ ] Application-level heartbeat
- [ ] PWA standalone 問題（加分不急）
- [ ] File tree lazy load
- [ ] 離線瀏覽已 cache 的檔案（local path）

**User Notes**:
- iCloud 私密轉送是 Safari WS 連不上的 root cause
- PWA 是加分不急，瀏覽器版先做好
- File tree 狀態管理是下個重點
- User 問：chat session 是否要讓 extension 存自己的 local file session？目前 session 只存在 frontend IndexedDB cache，extension 端無持久化。如果要做 Desktop Copilot Chat session 延續（讀 .jsonl），是另一個 feature。

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
