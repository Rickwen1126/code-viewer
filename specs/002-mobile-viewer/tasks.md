# Tasks: Mobile Code Viewer

**Input**: Design documents from `/specs/002-mobile-viewer/`
**Prerequisites**: plan.md, spec.md, data-model.md, contracts/, research.md, quickstart.md

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Include exact file paths in descriptions

---

## Phase 1: Setup（Monorepo 初始化）

**Purpose**: 建立 pnpm monorepo，4 個 package 的基本骨架與開發工具鏈

- [ ] T001 Initialize pnpm monorepo with pnpm-workspace.yaml（packages: packages/shared, backend, frontend, extension）
- [ ] T002 [P] Create packages/shared package（package.json, tsconfig.json, src/index.ts entry）
- [ ] T003 [P] Create backend package with Hono dependencies（hono, @hono/node-ws, @hono/node-server）in backend/package.json
- [ ] T004 [P] Create frontend package with Vite + React 19 + React Router v7 in frontend/package.json
- [ ] T005 [P] Create extension package with vscode + ws dependencies in extension/package.json
- [ ] T006 [P] Configure shared ESLint + Prettier across monorepo（root eslint.config.js, .prettierrc）
- [ ] T007 [P] Configure Vitest in root and each package（vitest.config.ts, vitest.workspace.ts）

**Checkpoint**: `pnpm install` 成功，各 package 可獨立 `pnpm build` / `pnpm typecheck`

---

## Phase 2: Foundational（WS 三端基礎建設）

**Purpose**: 建立 Extension↔Backend↔Frontend 的 WebSocket 通訊骨架，
所有 User Story 都依賴此基礎

**⚠️ CRITICAL**: 此 phase 完成前不可開始任何 User Story

### 2A: Shared Types

- [ ] T008 [P] Define WsMessage interface, message type string literals, and ErrorPayload in packages/shared/src/ws-types.ts（per contracts/ws-protocol.md）
- [ ] T009 [P] Define shared data models（FileTreeNode, FileContent, Workspace, GitStatus, ChangedFile, FileDiff, DiffHunk, DiffChange, ChatSession, ChatTurn, PendingEdit, ToolRequest, CodeTour, TourStep）in packages/shared/src/models.ts（per data-model.md）

### 2B: Backend WS Server

- [ ] T010 Implement Hono app entry point with GET /health route and serve() in backend/src/index.ts
- [ ] T011 Implement WS connection manager（extensions Map, frontends Map, heartbeat timer, stale detection 40s, stale cleanup 5min）in backend/src/ws/manager.ts
- [ ] T012 Implement WS upgrade handler for /ws/extension and /ws/frontend endpoints（connection.welcome, workspace.register handling）in backend/src/ws/handler.ts
- [ ] T013 Implement message relay（Frontend request → Extension forward → response route back; Extension event → Frontend broadcast）in backend/src/ws/relay.ts
- [ ] T014 Implement session cache（fileTreeCache, workspaceInfoCache with 5min TTL）in backend/src/cache/session.ts

### 2C: Extension WS Client

- [ ] T015 Implement WS client with auto-reconnect（exponential backoff, workspace.register on connect）in extension/src/ws/client.ts
- [ ] T016 Implement extension entry point（activation, WS client init, command registration）in extension/src/extension.ts
- [ ] T017 Implement message routing dispatch（incoming request → provider function → response）in extension/src/ws/client.ts

### 2D: Frontend WS Client + Navigation Shell

- [ ] T018 Implement WS client service（connect, disconnect, send, subscribe, auto-reconnect）in frontend/src/services/ws-client.ts
- [ ] T019 Implement useWebSocket hook（connection state, send helper, message subscription）in frontend/src/hooks/use-websocket.ts
- [ ] T020 Implement IndexedDB cache service（file-tree, file-content, chat-sessions, git-status stores）in frontend/src/services/cache.ts
- [ ] T021 Implement useCache hook（get, set, invalidate per store）in frontend/src/hooks/use-cache.ts
- [ ] T022 Setup React Router v7 with tab layout（6 tabs as nested routes, Activity for tab state preservation）in frontend/src/app.tsx
- [ ] T023 Implement TabBar component（6 tabs: Workspaces, Files, Git, Tours, Chat, Review; 56px height + safe-area; Lucide icons; active indicator; badge support）in frontend/src/components/tab-bar.tsx
- [ ] T024 Implement ConnectionStatus component（connected/reconnecting/disconnected states; top banner）in frontend/src/components/connection-status.tsx
- [ ] T025 Configure PWA manifest（name, icons, theme-color, display: standalone）in frontend/public/manifest.json

**Checkpoint**: 三端可連線 — Backend 啟動，Extension 連上 Backend 並 register workspace，
Frontend 連上 Backend 並看到 Tab Bar shell + connection status。可用 wscat 手動測 relay。

---

## Phase 3: User Story 1 — 手機瀏覽專案檔案 (Priority: P1) 🎯 MVP

**Goal**: 在手機上看到 Desktop VS Code 的檔案樹，點選檔案看到語法高亮程式碼

**Independent Test**: 開啟手機 → 選擇 workspace → 看到檔案樹 → 點檔案 → 看到 Shiki 高亮的程式碼

### Extension

- [ ] T026 [P] [US1] Implement file provider — file.tree（workspace.fs readDirectory recursive）and file.read（workspace.fs readFile + dirty buffer via TextDocument）in extension/src/providers/file-provider.ts
- [ ] T027 [P] [US1] Implement file.treeChanged（FileSystemWatcher）and file.contentChanged（onDidChangeTextDocument）event emitters in extension/src/providers/file-provider.ts

### Frontend

- [ ] T028 [US1] Implement workspace selector page（connection.listWorkspaces → card list with rootPath, gitBranch, status indicator; connection.selectWorkspace on tap）in frontend/src/pages/workspaces/
- [ ] T029 [US1] Implement useWorkspace hook（selected workspace state, selectWorkspace action, extensionConnected/Disconnected event handling）in frontend/src/hooks/use-workspace.ts
- [ ] T030 [US1] Implement file browser page（file.tree → collapsible directory tree; gitignored files dimmed; dirty indicator dot; tap file → navigate to code viewer）in frontend/src/pages/files/
- [ ] T031 [US1] Implement Shiki code-block component（createHighlighter with JS engine + dark-plus theme; codeToTokens per-line; line numbers gutter; Web Worker for >300 lines）in frontend/src/components/code-block.tsx
- [ ] T032 [US1] Implement code viewer page（file.read → code-block; loading skeleton; file name + languageId header; dirty banner）in frontend/src/pages/files/
- [ ] T033 [US1] Implement virtual scrolling for large files >300 lines with @tanstack/react-virtual wrapping code-block lines in frontend/src/pages/files/
- [ ] T034 [US1] Implement offline file cache — on file.tree.result update IndexedDB file-tree store; on file.read.result update file-content store with 24h TTL; offline fallback reads from cache in frontend/src/hooks/use-cache.ts
- [ ] T035 [US1] Implement swipe-back gesture with react-swipeable（left-edge 20px trigger zone, >100px threshold → navigate(-1), translateX animation）in frontend/src/app.tsx

**Checkpoint**: US1 完整可用 — 手機上選 workspace → 瀏覽檔案樹 → 看程式碼 → 離線可看快取 → swipe 返回

---

## Phase 4: User Story 2 — Code Intelligence (Priority: P2)

**Goal**: 在程式碼上 tap 看 hover 資訊，長按跳轉定義、查引用、看 symbol 大綱

**Independent Test**: tap 變數 → 看到型別 hover → 長按 → Go to Definition 跳轉 → 開 outline → 跳轉

### Extension

- [ ] T036 [P] [US2] Implement LSP provider — lsp.hover（executeHoverProvider）, lsp.definition（executeDefinitionProvider）, lsp.references（executeReferenceProvider）, lsp.documentSymbol（executeDocumentSymbolProvider）in extension/src/providers/lsp-provider.ts

### Frontend

- [ ] T037 [US2] Implement tap-to-hover in code viewer — tap token → compute line/character from tap position → lsp.hover → render floating tooltip（Markdown content, dismiss on tap outside）in frontend/src/pages/files/
- [ ] T038 [US2] Implement action sheet component（bottom sheet with action list; 44px touch targets; slide-up animation）in frontend/src/components/action-sheet.tsx
- [ ] T039 [US2] Implement long-press on code token → action sheet（Go to Definition, Find References, Document Symbols）→ dispatch corresponding lsp.* request in frontend/src/pages/files/
- [ ] T040 [US2] Implement Go to Definition navigation — lsp.definition.result → navigate to target file + scroll to line; handle cross-file jump in frontend/src/pages/files/
- [ ] T041 [US2] Implement references list view — lsp.references.result → list with file path, line preview; tap → navigate to file + line in frontend/src/pages/files/
- [ ] T042 [US2] Implement document symbol outline — lsp.documentSymbol.result → hierarchical list（kind icon + name）; tap → scroll to range in current file in frontend/src/pages/files/

**Checkpoint**: US2 完整可用 — 所有 LSP 功能均透過 Extension 委託，回應時間 < 3s

---

## Phase 5: User Story 3 — Git 狀態 (Priority: P3)

**Goal**: 在手機上看 branch、修改列表、行級 diff

**Independent Test**: 開 Git tab → 看到 branch 和修改列表 → tap 檔案 → 看到 unified diff

### Extension

- [ ] T043 [P] [US3] Implement git provider — git.status（Git API: repository.state + repository.diffWithHEAD）, git.diff（per-file diff with hunk parsing）, git.statusChanged event in extension/src/providers/git-provider.ts

### Frontend

- [ ] T044 [US3] Implement git changes page — git.status → branch name header + ahead/behind badges + changed files list（status icon color: green=added, yellow=modified, red=deleted）in frontend/src/pages/git/
- [ ] T045 [US3] Implement diff-view component — unified view; Shiki highlighted old/new lines; add(green)/delete(red)/normal styling; hunk headers; virtual scrolling for large diffs in frontend/src/components/diff-view.tsx
- [ ] T046 [US3] Implement git diff detail page — tap changed file → git.diff → diff-view component in frontend/src/pages/git/
- [ ] T047 [US3] Implement offline git-status cache in IndexedDB git-status store in frontend/src/hooks/use-cache.ts

**Checkpoint**: US3 完整可用 — Git tab 顯示 branch + 修改檔 → diff 有語法高亮

---

## Phase 6: User Story 4 — Copilot Chat (Priority: P4)

**Goal**: 在手機上看 Copilot Chat 歷史、送訊息、看 streaming 回答

**Independent Test**: 開 Chat tab → 看到 session 列表 → 進入 session → 送追問 → streaming 逐字顯示

### Extension

- [ ] T048 [P] [US4] Implement copilot provider — chat.listSessions, chat.getHistory, chat.send（trigger vscode.lm or workbench.action.chat.open）, chat.stream.chunk event relay, chat.sessionUpdated event in extension/src/providers/copilot-provider.ts

### Frontend

- [ ] T049 [US4] Implement chat session list page — chat.listSessions → session cards（title, mode badge, lastActiveAt, turnCount）; tap → navigate to conversation in frontend/src/pages/chat/
- [ ] T050 [US4] Implement chat conversation page — chat.getHistory → message bubbles（user right, copilot left）; input bar at bottom with send button; chat.send on submit in frontend/src/pages/chat/
- [ ] T051 [US4] Implement streaming response — subscribe to chat.stream.chunk events; append chunks to current turn response; blinking cursor during streaming; auto-scroll to bottom in frontend/src/pages/chat/
- [ ] T052 [US4] Implement code block syntax highlighting in chat messages — detect markdown fenced code blocks in response → render with code-block component（reuse from US1）in frontend/src/pages/chat/
- [ ] T053 [US4] Implement offline chat cache — cache chat-sessions store in IndexedDB; offline → read-only history in frontend/src/hooks/use-cache.ts

**Checkpoint**: US4 完整可用 — Chat 歷史可瀏覽、追問有 streaming 回答、code block 有語法高亮

---

## Phase 7: User Story 5 — Edit Review (Priority: P5)

**Goal**: 在手機上 review Copilot 建議的修改 diff，approve/reject edits 和 accept/skip tools

**Independent Test**: 開 Review tab → 看到 pending edits → 看 diff → approve → Desktop 套用修改

### Extension

- [ ] T054 [P] [US5] Implement review provider — review.listPendingEdits, review.getEditDiff, review.approveEdit, review.rejectEdit, review.listToolRequests, review.acceptTool, review.skipTool, review.pendingEditsChanged event in extension/src/providers/copilot-provider.ts

### Frontend

- [ ] T055 [US5] Implement pending edits list page — review.listPendingEdits → file cards（filePath, hunksCount, status badge）in frontend/src/pages/review/
- [ ] T056 [US5] Implement edit diff review page — review.getEditDiff → reuse diff-view component; approve/reject buttons（44px, green/red）at bottom in frontend/src/pages/review/
- [ ] T057 [US5] Implement tool approval list — review.listToolRequests → tool cards（toolName, description, parameters summary）; accept/skip buttons in frontend/src/pages/review/
- [ ] T058 [US5] Implement review tab badge — subscribe to review.pendingEditsChanged event → update TabBar badge count in frontend/src/components/tab-bar.tsx

**Checkpoint**: US5 完整可用 — Review tab 有 badge → 看 diff → approve/reject → Desktop 即時反映

---

## Phase 8: User Story 6 — Code Tour (Priority: P6)

**Goal**: 在手機上瀏覽 CodeTour 步驟，read-only

**Independent Test**: 開 Tours tab → 看到 tour 列表 → 選一個 → 逐步瀏覽 → 跳到 Code Viewer

### Extension

- [ ] T059 [P] [US6] Implement tour provider — tour.list（read .tours/*.tour JSON files via workspace.fs）, tour.getSteps（parse steps array）in extension/src/providers/tour-provider.ts

### Frontend

- [ ] T060 [US6] Implement tour list page — tour.list → tour cards（title, description, stepCount）in frontend/src/pages/tours/
- [ ] T061 [US6] Implement tour detail page — tour.getSteps → step navigation（prev/next buttons + swipe）; code snippet with Shiki highlight（file + line range）; description markdown in frontend/src/pages/tours/
- [ ] T062 [US6] Implement "View in Code Viewer" link — tap → navigate to /files/:path with scroll to line number in frontend/src/pages/tours/
- [ ] T063 [US6] Implement tour progress tracking — localStorage key tour-progress:{extensionId}:{tourId} → { currentStep } in frontend/src/pages/tours/

**Checkpoint**: US6 完整可用 — Tour 列表 → 逐步瀏覽 → 跳到 Code Viewer

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: 跨 story 的體驗優化和生產準備

- [ ] T064 [P] Implement View Transitions API for page animations（stack push: slide-in-right; tab switch: crossfade）in frontend/src/app.tsx
- [ ] T065 [P] Implement pull-to-refresh（overscroll-behavior: contain + custom touch handler）in frontend/src/app.tsx
- [ ] T066 [P] Implement pinch-to-zoom for code viewer（font-size scaling with transform）in frontend/src/components/code-block.tsx
- [ ] T067 [P] Add safe-area handling（env(safe-area-inset-*) for notch + home indicator）across all layout components
- [ ] T068 Performance audit — Shiki bundle size check（target <135KB gzip）, virtual scrolling validation, WS message size profiling
- [ ] T069 Validate quickstart.md end-to-end — follow all steps on clean machine, verify all 5 startup steps work

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**: No dependencies — start immediately
- **Phase 2 Foundational**: Depends on Phase 1 — BLOCKS all user stories
- **Phase 3-8 User Stories**: All depend on Phase 2 completion
  - US1 (P1): No story dependencies — **MVP target**
  - US2 (P2): Depends on US1 code viewer（extends with tap/long-press interactions）
  - US3 (P3): Independent of US1/US2（separate Git tab）; reuses diff-view in US5
  - US4 (P4): Independent of US1-US3（separate Chat tab）; reuses code-block component
  - US5 (P5): Depends on US3 diff-view component; independent of US4
  - US6 (P6): Depends on US1 code viewer（"View in Code Viewer" link）; reuses code-block
- **Phase 9 Polish**: After desired user stories complete

### Within Each User Story

```
Extension provider [P] ──┐
                         ├──► Frontend pages（sequential within story）
Shared types（Phase 2）──┘
```

### Parallel Opportunities

**Phase 1**: T002-T007 全部可平行
**Phase 2**: T008-T009 平行 → T010-T014 + T015-T017 + T018-T025 三端可平行開發
**Phase 3+**: 每個 story 的 Extension provider [P] 可與其他 story 的 Extension provider 平行

---

## Parallel Example: Phase 2 三端平行

```bash
# 先完成 shared types（T008, T009）
# 然後三端同時開發：

# Agent 1: Backend
Task: T010 "Hono app entry point in backend/src/index.ts"
Task: T011 "WS connection manager in backend/src/ws/manager.ts"
Task: T012 "WS handler in backend/src/ws/handler.ts"
Task: T013 "Message relay in backend/src/ws/relay.ts"
Task: T014 "Session cache in backend/src/cache/session.ts"

# Agent 2: Extension
Task: T015 "WS client in extension/src/ws/client.ts"
Task: T016 "Extension entry point in extension/src/extension.ts"
Task: T017 "Message routing in extension/src/ws/client.ts"

# Agent 3: Frontend
Task: T018-T025 (WS client + navigation shell)
```

---

## Implementation Strategy

### MVP First（US1 Only）

1. Phase 1: Setup → `pnpm install` works
2. Phase 2: Foundational → 三端 WS 連通
3. Phase 3: US1 → 手機上看程式碼 ✅
4. **STOP and VALIDATE**: SC-001（<5s 看到檔案樹）+ SC-002（<2s 語法高亮）

### Incremental Delivery

1. Setup + Foundational → WS 骨架 ready
2. + US1 → **MVP: 手機看 code** 🎯
3. + US2 → 加上 code intelligence（hover, jump）
4. + US3 → 加上 Git status + diff
5. + US4 → 加上 Copilot Chat
6. + US5 → 加上 Edit Review（depends on US3 diff-view）
7. + US6 → 加上 Code Tour
8. Polish → 動畫、手勢、效能優化

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks in same phase
- [Story] label maps to spec.md user stories（US1=P1 檔案瀏覽 ... US6=P6 Code Tour）
- Extension providers 各自獨立（file, lsp, git, copilot, tour），可平行開發
- diff-view component（US3 T045）被 US5 review 重用
- code-block component（US1 T031）被 US4 chat + US6 tour 重用
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
