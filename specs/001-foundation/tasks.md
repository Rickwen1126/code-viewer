# Tasks: Foundation — 檔案瀏覽與語法高亮

**Input**: Design documents from `/specs/001-foundation/`
**Prerequisites**: plan.md, spec.md, data-model.md, contracts/, research.md, quickstart.md

**Tests**: 每個 User Story checkpoint 後包含真機驗證 task（Constitution MUST）。Phase 7 含 Playwright mobile E2E 基礎設定與效能驗證。

**Organization**: 按 User Story 分組，每個 Story 可獨立實作與驗證。

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 可平行執行（不同檔案、無依賴）
- **[Story]**: 所屬 User Story（US1, US2, US3, US4）

---

## Phase 1: Setup（專案初始化）

**Purpose**: 建立 monorepo 骨架，安裝所有依賴，確保 `pnpm install` 能跑過

- [x] T001 建立 monorepo root 設定：pnpm-workspace.yaml（含 extension, backend, frontend, packages/*）、root package.json（scripts: dev, build, lint）、root tsconfig.json（base config）
- [x] T002 [P] 初始化 packages/protocol/：package.json（name: @code-viewer/protocol）、tsconfig.json、src/index.ts（空 export）
- [x] T003 [P] 初始化 backend/：package.json（hono, @hono/node-server, @hono/node-ws, @code-viewer/protocol）、tsconfig.json、Dockerfile（Node.js 22 Alpine）、src/index.ts + src/app.ts（空殼）
- [x] T004 [P] 初始化 frontend/：Vite + React 19 scaffold、package.json（shiki, @shikijs/langs, @tanstack/react-virtual, @code-viewer/protocol）、vite.config.ts、tsconfig.json
- [x] T005 [P] 初始化 extension/：package.json（vscode engine, ws ^8.x, @code-viewer/protocol）、tsconfig.json、esbuild.mjs（bundle ws, externalize bufferutil/utf-8-validate）
- [x] T006 建立 docker-compose.yml（code-server 4.109.2 + backend + volume mounts）與 config.json 範例檔（參考 quickstart.md）
- [x] T007 執行 pnpm install 並驗證 monorepo workspace linking 正確（packages/protocol 可被其他三個 package import）

---

## Phase 2: Foundational（阻塞性基礎建設）

**Purpose**: 所有 User Story 共用的核心基礎設施。此 Phase 未完成前，不得開始任何 User Story

**⚠️ CRITICAL**: Phase 2 是所有 User Story 的前置條件

- [x] T008 實作共享 JSON-RPC 2.0 型別 in packages/protocol/src/index.ts — 包含 BridgeRequest, BridgeResponse, BridgeError, 自訂錯誤碼常數（WORKSPACE_NOT_OPEN -32000, LSP_UNAVAILABLE -32001, PATH_OUTSIDE_ROOT -32002, FILE_TOO_LARGE -32003, BINARY_FILE -32004），以及所有 method 的 params/result 型別（參考 contracts/ws-protocol.md + data-model.md）
- [x] T009 [P] 實作 Backend 設定載入 in backend/src/config.ts — 載入並驗證 config.json，export ServerConfig 型別（projects 陣列 + codeServerUrl + port），啟動時驗證 project rootPaths 存在
- [x] T010 [P] 實作 Backend path-guard middleware in backend/src/middleware/path-guard.ts — 驗證請求路徑在 project rootPath 之下，阻擋 path traversal（../ 攻擊），不合法路徑回傳 error code -32002（FR-013）
- [x] T011 實作 Backend app shell in backend/src/app.ts — 建立 Hono instance，CORS middleware 只套在 /api/* 路徑（不可全域），掛載 route groups（/api/*, /ws/*），統一 error handler 回傳 JSON-RPC error 格式
- [x] T012 實作 Backend server bootstrap in backend/src/index.ts — 使用 @hono/node-server 啟動 HTTP server，使用 injectWebSocket 啟用 WebSocket 支援，讀取 config 決定 port
- [x] T013 [P] 實作 Extension WebSocket bridge client in extension/src/bridge-client.ts — ws 連線到 Backend /ws/vscode-bridge endpoint，指數退避重連（1s base, 2x factor, 60s max, ±20% jitter），heartbeat（25s ping, 10s pong timeout），實作 vscode.Disposable 介面，push 到 context.subscriptions，message dispatch（收到 JSON-RPC request → 根據 method 呼叫對應 handler → 回傳 JSON-RPC response）
- [x] T014 [P] 實作 Extension pending-requests.ts in extension/src/pending-requests.ts — UUID-based request/response correlation map，timeout 機制（預設 30s），斷線時 reject 所有 pending entries 並清空 map，供未來 Extension→Backend 方向使用
- [x] T015 實作 Extension entry point in extension/src/extension.ts — activate()：建立 BridgeClient、註冊所有 method handlers、push disposables 到 context.subscriptions。deactivate()：graceful shutdown（送 WebSocket close frame with 1000 Normal Closure → 等對方 close 確認 → 清理）。handler 註冊框架（method name → handler function 的 registry）
- [x] T016 實作 Backend WebSocket bridge endpoint in backend/src/routes/ws/index.ts + backend/src/routes/ws/bridge.ts — 使用 upgradeWebSocket() 處理 /ws/vscode-bridge，單一 active connection slot（新連線取代舊連線），將 WebSocket instance 注入 bridge-proxy service
- [x] T017 實作 Backend bridge proxy service in backend/src/services/bridge-proxy.ts — 維護 active WebSocket reference，PendingRequestMap（UUID → Promise resolve/reject），sendRequest(method, params) → Promise<result>，timeout 30s，斷線時 reject all pending，expose isConnected() 供路由層判斷
- [x] T018 [P] 建立 Frontend app shell in frontend/src/App.tsx — React Router（/ → home, /project/:id → project page），全域 layout，套用 design tokens 為 CSS custom properties（參考 docs/tokens.md 的 CSS Custom Properties 段落），引入 JetBrains Mono + Inter 字型，Tab Bar 結構（per design.pen，Foundation 只啟用 REPOS + FILES）
- [x] T019 [P] 實作 Frontend API client in frontend/src/services/api-client.ts — typed fetch wrapper，涵蓋所有 REST endpoints（GET /api/projects, GET /api/projects/:id/files, GET /api/projects/:id/file, GET /api/status），統一 error handling，回傳型別對應 data-model.md 的 entity types

**Checkpoint**: 基礎設施就緒 — 三個元件可啟動、WebSocket bridge 可連線、API client 可呼叫。User Story 實作可開始。

---

## Phase 3: User Story 1 — 手機瀏覽專案檔案樹 (Priority: P1) 🎯 MVP

**Goal**: 使用者選擇專案後看到完整檔案樹，可展開/收合資料夾，gitignored 檔案可見

**Independent Test**: 開啟 app → 選專案 → 看到檔案樹 → 點擊展開資料夾 → 確認 gitignored 檔案可見

**Design Reference**: design.pen — File Browser screen (node VeKZW)

### Implementation

- [ ] T020 [P] [US1] 實作 Extension fs/readDirectory handler in extension/src/handlers/fs.ts — 呼叫 workspace.fs.readDirectory()，回傳 FileNode[]（name, type），包含 gitignored 檔案（workspace.fs 不 respect .gitignore）
- [ ] T021 [P] [US1] 實作 Backend GET /api/projects/:id/files route in backend/src/routes/api/files.ts — 接收 ?path= query param（預設 ""），透過 path-guard 驗證路徑，呼叫 bridge-proxy.sendRequest('fs/readDirectory')，回傳 FileNode[] 包裝在 { data: [...] }
- [ ] T022 [US1] 實作 Frontend use-file-tree hook in frontend/src/hooks/use-file-tree.ts — lazy load（展開資料夾時才載入子目錄），管理 expand/collapse 狀態（per-node toggle），loading 狀態（FR-011），error 處理
- [ ] T023 [US1] 實作 Frontend file-tree component in frontend/src/components/file-tree/ — 按照 design.pen File Browser screen 配置：資料夾/檔案 icon（Lucide）、縮排層級、touch target ≥44px、資料夾點擊 expand/collapse、檔案點擊觸發 onFileSelect callback、breadcrumb 路徑顯示
- [ ] T024 [US1] 整合 file tree 到 project page in frontend/src/pages/project.tsx — 掛載 file-tree component，接收 projectId from route params，breadcrumb 導航，file 點擊暫時顯示 placeholder（US2 實作程式碼檢視器）

### Verification

- [ ] T047 [US1] 真機驗證 US1 — 在實際行動裝置（iPhone Safari / Android Chrome）上操作：開啟 app → 選專案 → 看到檔案樹 → 展開資料夾 → 確認 gitignored 檔案可見 → touch target 可正常點擊。記錄任何 UX 問題。（Constitution VI: 實際行動裝置驗證）

**Checkpoint**: 檔案樹功能完整可用，真機驗證通過。

---

## Phase 4: User Story 2 — 閱讀檔案內容（語法高亮）(Priority: P1)

**Goal**: 點擊檔案後顯示語法高亮的程式碼，手機友善排版，行號 + 水平捲動

**Independent Test**: 點擊 .ts 檔案 → 看到語法高亮的內容 → 行號顯示 → 可上下左右捲動

**Design Reference**: design.pen — Code Viewer screen (node QxGIC)

### Implementation

- [ ] T025 [P] [US2] 實作 Extension fs/readFile 和 fs/stat handlers in extension/src/handlers/fs.ts — readFile: workspace.fs.readFile() → TextDecoder 解碼，回傳 { content, size }。stat: workspace.fs.stat() → 回傳 { type, size, mtime }。大檔案由 Backend 處理截斷，Extension 端不截斷
- [ ] T026 [P] [US2] 實作 Backend GET /api/projects/:id/file route in backend/src/routes/api/files.ts — 接收 ?path= query param（required），path-guard 驗證，先透過 bridge-proxy 取得 stat（檢查大小），二進位偵測（前 8192 bytes 是否含 null byte → isBinary=true 時 content=null），超過 5MB 截斷至前 1000 行（truncated=true），語言偵測（副檔名 → language id），回傳 FileContent 包裝在 { data: {...} }
- [ ] T027 [P] [US2] 實作 Frontend Shiki Web Worker in frontend/src/workers/shiki-worker.ts — createHighlighterCore + createJavaScriptRegexEngine()，動態 import @shikijs/langs/<name>（lazy），expose codeToTokens() via postMessage API，支援 20+ 語言（SC-003：TypeScript, JavaScript, Python, Go, Rust, Java, C, C++, HTML, CSS, JSON, YAML, Markdown, Shell, SQL, Ruby, Swift, Kotlin, Dart, PHP）
- [ ] T028 [US2] 實作 Frontend use-file-content hook in frontend/src/hooks/use-file-content.ts — fetch file content via API client，偵測 isBinary/truncated 狀態，將 content + language 送進 Shiki Worker 做 tokenization，回傳 tokens 陣列 + metadata + loading 狀態
- [ ] T029 [US2] 實作 Frontend code-viewer component in frontend/src/components/code-viewer/ — 按照 design.pen Code Viewer screen 配置：@tanstack/react-virtual 做 virtual scrolling（只渲染可見行），token-level 渲染（每個 token 套用 syntax color from tokens.md），行號欄（JetBrains Mono, text-muted 色），水平捲動（FR-005），字體大小足以閱讀不需縮放（SC-005, 12px JetBrains Mono），二進位檔案顯示檔案資訊（FR-009），截斷提示（FR-010）
- [ ] T030 [US2] 整合 code viewer 到 project page in frontend/src/pages/project.tsx — 檔案點擊（from file-tree onFileSelect）→ 載入 file content → 顯示 code-viewer，返回按鈕回到 file tree，loading skeleton 過場

### Verification

- [ ] T048 [US2] 真機驗證 US2 — 在實際行動裝置上操作：點擊 .ts 檔案 → 語法高亮渲染 → 行號可見 → 水平捲動正常 → 字體大小可讀（不需縮放）→ 二進位檔案顯示資訊而非內容 → 大檔案顯示截斷提示。記錄任何 UX 問題。（Constitution VI: 實際行動裝置驗證）

**Checkpoint**: MVP 核心功能完成（檔案樹 + 語法高亮），真機驗證通過。

---

## Phase 5: User Story 3 — 專案選擇與切換 (Priority: P2)

**Goal**: 使用者看到專案列表，選擇進入瀏覽，可切換專案

**Independent Test**: 開啟 app → 看到專案列表 → 選擇 A 專案 → 切換到 B 專案 → 確認檔案樹更新

**Design Reference**: design.pen — Repo Selector screen (node P5iYV)

### Implementation

- [ ] T031 [P] [US3] 實作 Extension workspace handlers in extension/src/handlers/workspace.ts — addFolder: vscode.workspace.updateWorkspaceFolders() 加入資料夾，等待 onDidChangeWorkspaceFolders 事件確認，回傳 { success: true }。removeFolder: 同理移除。注意不可連續呼叫，需等前一個完成
- [ ] T032 [P] [US3] 實作 Backend GET /api/projects route in backend/src/routes/api/projects.ts — 從 config 讀取 projects 陣列，回傳 { data: Project[] }
- [ ] T033 [US3] 實作 Frontend project-list component in frontend/src/components/project-list/ — 按照 design.pen Repo Selector screen 配置：搜尋框、RECENT section、ALL PROJECTS section、project card（icon + name + path + branch count + chevron）、touch target ≥44px、空狀態提示（無專案時引導設定）
- [ ] T034 [US3] 實作 Frontend home page in frontend/src/pages/home.tsx — 掛載 project-list，選擇專案 → navigate to /project/:id，頁面標題 "Open a Repo"
- [ ] T035 [US3] 實作專案切換邏輯 — 選擇新專案時透過 API 觸發 workspace/addFolder（讓 Extension 開啟對應 workspace），前端 navigate 到新 project page，檔案樹重新載入。處理切換期間的 loading 狀態

### Verification

- [ ] T049 [US3] 真機驗證 US3 — 在實際行動裝置上操作：開啟 app → 看到專案列表 → 選擇 A 專案 → 看到檔案樹 → 返回選擇 B 專案 → 確認檔案樹更新為 B → 無專案時看到引導提示。記錄任何 UX 問題。

**Checkpoint**: 專案選擇與切換完整可用，真機驗證通過。

---

## Phase 6: User Story 4 — 系統離線時的基本可用性 (Priority: P3)

**Goal**: code-server 離線時透過 fallback 仍可瀏覽檔案，恢復後自動切回

**Independent Test**: 關閉 code-server → 開啟 app → 仍可看到檔案樹 → 仍可閱讀檔案 → 重啟 code-server → 自動恢復

### Implementation

- [ ] T036 [P] [US4] 實作 Backend fallback FS service in backend/src/services/fallback-fs.ts — 使用 Node.js fs/promises 直接讀取容器內檔案系統。readDirectory: fs.readdir + fs.stat 組合回傳 FileNode[]。readFile: fs.readFile + binary 偵測（前 8192 bytes null byte 檢查）+ 大檔案截斷（5MB / 1000 行）+ language 偵測。path-guard 同樣適用
- [ ] T037 [US4] 修改 Backend files routes 加入 fallback 路由邏輯 in backend/src/routes/api/files.ts — bridge-proxy.isConnected() ? 透過 bridge proxy 處理 : 使用 fallback-fs 直接讀取。切換對 client 透明（相同 response 格式）
- [ ] T038 [P] [US4] 實作 Backend GET /api/status route in backend/src/routes/api/status.ts — 回傳 { data: { bridge: BridgeStatus, version: string } }，bridge 狀態從 bridge-proxy 取得
- [ ] T039 [US4] 實作 Frontend use-bridge-status hook in frontend/src/hooks/use-bridge-status.ts — 定期 poll GET /api/status（間隔 10s），expose bridge 狀態（connected / disconnected / warming_up），狀態變化時觸發 re-render
- [ ] T040 [US4] 實作 Frontend status-bar component in frontend/src/components/status-bar/ — bridge 狀態指示器，disconnected 時顯示「Fallback 模式」提示，warming_up 時顯示「正在準備」，connected 時隱藏或顯示綠色指示
- [ ] T041 [US4] 整合 fallback UX 到現有頁面 — status-bar 嵌入全域 layout，bridge 狀態變化時現有功能（file tree + code viewer）無需手動重新操作（FR-008），自動恢復切回 Extension 模式

### Verification

- [ ] T050 [US4] 真機驗證 US4 — 停止 code-server container → 開啟 app → 確認仍可瀏覽檔案樹 + 閱讀檔案 → 看到 Fallback 模式提示 → 重啟 code-server → 確認自動恢復且提示消失。記錄任何 UX 問題。

**Checkpoint**: Fallback 機制完整可用，真機驗證通過。

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: 跨 User Story 的收尾工作

- [ ] T042 [P] 處理 edge case：特殊字元路徑（FR-012）— 驗證 API client URL encoding、path-guard 對空白/中文/符號路徑的處理、frontend breadcrumb 顯示
- [ ] T043 [P] 補齊所有 async 操作的 loading 狀態（FR-011）— file-tree skeleton、code-viewer skeleton、project-list skeleton、全域 loading indicator。加入頁面轉場動畫（file tree ↔ code viewer 用 slide transition，home ↔ project 用 fade transition）（Constitution VI: 動畫、過渡效果 MUST 精心設計）
- [ ] T044 [P] 完善 Tab Bar 導航 — per design.pen 底部 Tab Bar（REPOS, FILES, TOURS, SEARCH）。路由邏輯：REPOS tab → home.tsx（/），FILES tab → project.tsx（/project/:id）。切換 tab 時保留各頁狀態（file tree 展開狀態、已選檔案）。未啟用的 tab（TOURS, SEARCH）顯示 disabled 狀態。code-viewer 全螢幕時隱藏 Tab Bar
- [ ] T045 Docker Compose 完整化 — 確認 Dockerfile build、volume mounts、environment variables。health check script：啟動後自動 curl code-server URL 一次以觸發 Extension Host 啟動（Known Limitation: 需瀏覽器連入）。Frontend production build 由 Backend static serve（Hono serveStatic），不額外開 container
- [ ] T046 驗證 quickstart.md — 從零開始按照步驟操作，確認所有流程可重現，更新有出入的內容
- [ ] T051 [P] PC viewport 處理 — Frontend 加入 max-width: 480px + margin: 0 auto 的外層容器，背景色 bg-sidebar 填滿螢幕。PC 連入時顯示手機版居中 layout，不做 responsive 切版（per spec clarification）
- [ ] T052 [P] Playwright mobile E2E 基礎設定 — 安裝 Playwright，設定 mobile viewport（iPhone 14, 402x874），撰寫 smoke test：開啟 app → 選專案 → 看到檔案樹 → 點擊檔案 → 看到語法高亮。CI 可選整合
- [ ] T053 效能驗證 — 在 Docker 環境中以 Playwright 或手動計時驗證 SC-001（app → 檔案樹 <5s）、SC-002（點擊檔案 → 語法高亮 <2s）、SC-004（fallback 回應 <3s）。記錄結果，未達標則開 issue 追蹤

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: 無依賴，立即開始
- **Phase 2 (Foundational)**: 依賴 Phase 1 完成 — **阻塞所有 User Story**
- **Phase 3 (US1)**: 依賴 Phase 2 完成
- **Phase 4 (US2)**: 依賴 Phase 2 完成。Frontend 整合依賴 US1 的 file-tree（點擊檔案觸發）
- **Phase 5 (US3)**: 依賴 Phase 2 完成。可與 US1/US2 平行
- **Phase 6 (US4)**: 依賴 Phase 2 完成 + US1/US2 的 Backend routes 已存在（T037 修改 files.ts）
- **Phase 7 (Polish)**: 依賴所有 User Story 完成

### User Story Dependencies

```
Phase 1 (Setup)
    ↓
Phase 2 (Foundational)
    ↓
    ├── US1 (File Tree) ──→ US2 (Code Viewer) ──→ US4 (Fallback)
    │                                                    ↑
    └── US3 (Project Selection) ─────────────────────────┘
                                                         ↓
                                                   Phase 7 (Polish)
```

- **US1 → US2**: US2 的前端整合需要 US1 的 file-tree 提供檔案點擊入口
- **US1/US2 → US4**: US4 的 fallback routing（T037）修改 US1/US2 已建立的 files.ts
- **US3**: 獨立於 US1/US2，可平行進行（不同 route、不同 component）

### Within Each User Story

- Extension handler 和 Backend route 可平行（不同元件）
- Frontend hook 依賴 API client（Phase 2）
- Frontend component 依賴 hook
- Frontend page 整合依賴 component

### Parallel Opportunities

**Phase 1**: T002 + T003 + T004 + T005 可同時執行（四個 package 初始化）

**Phase 2**:
- T009 + T010 可同時（config + path-guard，不同檔案）
- T013 + T014 可同時（bridge-client + pending-requests，不同檔案）
- T018 + T019 可同時（app shell + API client，不同檔案）

**US1**: T020 + T021 可同時（Extension handler + Backend route，不同元件）

**US2**: T025 + T026 + T027 可同時（Extension handler + Backend route + Shiki Worker，三個不同元件）

**US3**: T031 + T032 可同時（Extension handler + Backend route）

**US4**: T036 + T038 可同時（fallback-fs + status route）

**Phase 7**: T042 + T043 + T044 + T051 + T052 可同時（不同關注點，不同檔案）

---

## Parallel Example: Phase 2 Foundational

```
# 第一波：無依賴的平行任務
Agent 1: T008 — packages/protocol 共享型別
Agent 2: T009 — backend config.ts
Agent 3: T010 — backend path-guard.ts

# 第二波：依賴 T008 的平行任務
Agent 1: T011 — backend app.ts（需要 protocol types）
Agent 2: T013 — extension bridge-client.ts（需要 protocol types）
Agent 3: T014 — extension pending-requests.ts（需要 protocol types）
Agent 4: T018 — frontend app shell
Agent 5: T019 — frontend API client（需要 protocol types）

# 第三波：依賴前一波的序列任務
T012 — backend index.ts（依賴 T011 app.ts）
T015 — extension extension.ts（依賴 T013 bridge-client）
T016 — backend ws/bridge.ts（依賴 T011 app.ts）
T017 — backend bridge-proxy.ts（依賴 T016 bridge endpoint）
```

---

## Implementation Strategy

### MVP First（US1 + US2）

1. Phase 1: Setup → monorepo 骨架就位
2. Phase 2: Foundational → 三元件可連線
3. Phase 3: US1 → 檔案樹可瀏覽
4. Phase 4: US2 → 程式碼可閱讀
5. **STOP and VALIDATE**: 手機開啟 → 看到檔案樹 → 點擊檔案 → 語法高亮呈現
6. 此時已可日常使用（手動選專案 via config.json）

### Incremental Delivery

1. Setup + Foundational → 基礎就位
2. US1 + US2 → **MVP!** 核心瀏覽功能
3. US3 → 多專案選擇（UX 提升）
4. US4 → 離線可用（穩定性提升）
5. Polish → 收尾
