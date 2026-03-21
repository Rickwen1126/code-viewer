# SHIP: 002-mobile-viewer

tags: [ship, mobile, vscode-extension, websocket, react]

## 1. Problem Statement
**問題**：在手機上瀏覽 Desktop VS Code 的程式碼、Git 狀態、Copilot Chat，觸控優化
**對象**：在通勤或離開電腦時需要看 code 的開發者（自己）
**成功條件**：手機上選 workspace → 看檔案 → 語法高亮 → LSP 跳轉 → Git diff → Copilot Chat，全部透過 Desktop VS Code Extension 委託

## 2. Solution Space
| 做法 | 優勢 | 風險/代價 |
|------|------|-----------|
| code-server (遠端 VS Code) | 完整 VS Code 體驗 | 手機 UI 差、需要雲端機器、Copilot 整合困難 |
| GitHub Mobile / Codespaces | 現成產品 | 沒有本機 VS Code 整合、無法看 dirty buffer |
| **Desktop Extension → Backend relay → Mobile PWA** | 利用既有 VS Code 能力、觸控優化、Copilot 原生整合 | 自建量大、依賴 Desktop 在線 |

**選擇**：Desktop Extension → Backend relay → Mobile PWA
**原因**：最大化利用使用者本機 VS Code 的 LSP、Git、Copilot 能力，Mobile 只做觸控優化呈現

## 3. 技術決策清單
| 決策點 | 選擇 | 原因 | 備選 |
|--------|------|------|------|
| Backend 框架 | Hono + @hono/node-ws | 輕量、TypeScript-first、HTTP+WS 共存 | Express+ws, Socket.IO, Bun native |
| 語法高亮 | Shiki v2 JS engine + react-shiki | VS Code 同款 TextMate grammar、不需 WASM | Prism.js, highlight.js, Shiki+Oniguruma |
| Frontend 框架 | React 19.2+ + React Router v7 | Activity 解決 tab state、成熟生態 | Ionic React, Framework7 |
| 行動導航 | 自建 Tab Bar + View Transitions | 避免 Ionic 設計綁定、最大彈性 | Ionic tabs, Framework7 |
| Diff 渲染 | Shiki 高亮 + 自建 unified view | Extension 送 hunks、Frontend 只渲染 | react-diff-viewer, Monaco diff |
| 離線快取 | IndexedDB (file-tree, file-content, chat, git) | 結構化資料、容量大、async | localStorage |
| 通訊協定 | WebSocket JSON (自訂 WsMessage 格式) | 即時推送 + streaming | REST polling, SSE |
| Monorepo | pnpm workspaces (4 packages) | 三端共用型別、統一工具鏈 | npm workspaces, turborepo |

## 4. 橫向掃描
| 參考 | 值得借鏡 | 要避開 |
|------|---------|--------|
| VS Code Web (vscode.dev) | 語言支援完整度 | Desktop 等級 UI 搬到手機 = 不可用 |
| GitHub Mobile | PR review 的觸控互動 | 無法存取本機 VS Code 狀態 |
| Ionic React | Tab+Stack 導航模式 | 80-120KB bundle、iOS PWA swipe-back bug |

## 5. 知識風險標記

### [B]lock（不理解，會影響方向）

- [x] **B1 VS Code Extension API 委託模型** ✅ 已解除
  - 解什麼問題：避免自己跑 N 個 LSP server，借用使用者 VS Code 已安裝的語言 Extension
  - 用錯會怎樣：自己跑 LSP → 每種語言一個 server，維護成本爆炸，功能永遠追不上原版
  - 為什麼選這做法：`execute*Provider` 一個 API 借用所有已安裝 Extension 的能力，零維護
  - 核心機制：
    - Extension Host 獨立 process，IPC message passing（非 shared memory）
    - `readFile` 走 IPC → Main → 磁碟；`executeProvider` 留在 Extension Host 內部問其他 Extension
    - 5MB 門檻：IPC 序列化 + Extension Host 記憶體保護

- [x] **B2 Hono WS relay 架構** ✅ 已解除
  - 解什麼問題：Backend 不做業務邏輯，只負責把 Frontend 和 Extension 連起來
  - 用錯會怎樣：解析 payload → 8 個 domain 都要寫解析邏輯 = 完整後端，開發維護成本爆炸，還要追 VS Code API 變更
  - 為什麼選這做法：純 relay 讓 Backend 跟業務邏輯完全解耦，Extension 怎麼改都不影響 Backend
  - 非 relay 的例外：
    - Connection domain（連線路由管理，Backend 本職）
    - file.tree cache（存原封不動的結果，不解析內容，5min TTL）
  - Hono gotchas：upgradeWebSocket 內不能 await、WS route 不套 CORS、injectWebSocket 必須在 serve() 之後

- [x] **B3 WebSocket 訊息路由** ✅ 已解除
  - 解什麼問題：WS 雙向通訊沒有天然的 request/response 配對，需要自建
  - 用錯會怎樣：沒有 id/replyTo → 同時多個 request 時無法辨識 response 屬於誰
  - 為什麼選這做法：id/replyTo 機制統一處理一對一（file.read）和一對多（chat streaming chunk）
  - 核心機制：
    - Frontend 維護 Map<id, Promise>，用 replyTo 配對
    - Streaming chunk 共用同一個 replyTo，一群 chunk 同屬一個 request
    - Heartbeat 三層（30s ping / 40s stale / 5min remove）避免 false positive 誤斷

### [R]isky（大概懂但不確定）
- **R1 Shiki engine system**：JS vs Oniguruma 差異大概知道，但動態載入語言 grammar 的快取機制不確定
  - Exit Questions:
    1. 動態 import 的 grammar 在 Vite production build 後存在哪？離線時怎麼取得？ [A]
- **R2 React 19.2 Activity**：知道是 keep-alive，但跟之前的 hack（手動 display:none）機制上差在哪不確定
  - Exit Questions:
    1. Activity hidden 時，裡面的 useEffect cleanup 會跑嗎？如果會，WS subscription 怎麼處理？ [A]
- **R3 PWA 離線模型**：IndexedDB 基本操作會，但 cache 策略（何時寫、何時讀、何時失效）不確定
  - Exit Questions:
    1. 如果使用者在離線時開了一個 24h 前快取的檔案，然後上線後該檔案被改了，什麼時候快取會更新？ [A]
- **R4 React Router v7 nested routes**：nested route 概念懂，但 Activity + Outlet 怎麼搭配做 tab 保持不確定
  - Exit Questions:
    1. 切換 tab 時 Outlet 裡的元件會 unmount 嗎？Activity 怎麼阻止這件事？ [A]
- **R5 觸控手勢衝突**：知道 touch event 有 capture/bubble，但程式碼區域水平滾動跟 swipe-back 怎麼共存不確定
  - Exit Questions:
    1. 為什麼限制在左邊緣 20px 觸發 swipe-back 就能解決衝突？如果使用者剛好在邊緣滾動程式碼呢？ [A]

### [R] 基礎技術（跟本專案實作直接相關）

- **R6 pnpm workspaces monorepo** ✅
  - `pnpm-workspace.yaml` 宣告哪些目錄是 package
  - `workspace:*` = 指向 monorepo 內部 package（symlink），不去 npm
  - 依賴方向單向：backend/frontend/extension → shared，三端不互相引用
  - shared `main` 直接指 `./src/index.ts`，不需要 build .d.ts，三端可同時 build
  - `--filter <name>` 對單一 package 下指令
- **R7 VS Code Extension 開發基礎** ✅
  - `activationEvents: ["onStartupFinished"]` — VS Code 啟動後自動載入
  - `main: "./dist/extension.js"` — Extension 必須 build（不像 frontend 可以直接跑 source）
  - `activate(context)` 初始化 WS client + 註冊 providers；`deactivate()` 斷線清理
  - `context.subscriptions.push(...)` 管理 lifecycle，Extension 停用自動 dispose
  - WS client 自己實作 exponential backoff（1s→2s→4s...cap 60s）無限重試，Backend 不能回戳 Extension
- **R8 WebSocket 基礎** ✅
  - HTTP GET + 101 Switching Protocols → 升級為 WS，跟 HTTP 共用 port
  - text frame（我們用 JSON）、binary frame、ping/pong control frame
  - 瀏覽器用 `onmessage`（WebSocket API）、Node.js 用 `on('message')`（ws 套件）
  - 瀏覽器不能手動 ping → heartbeat 由 Backend 主動發，client 自動回 pong
- **R9 Hono 框架基礎** ✅
  - 跨 runtime 框架，基於 Web 標準 API（Request/Response/fetch）
  - 我們的 Backend 只有 1 個 HTTP route（/health）+ 2 個 WS route
  - `upgradeWebSocket(handler)` 定義 WS 行為，`injectWebSocket(server)` 把 WS 接上 Node.js HTTP server
  - 兩者缺一不可，且 `injectWebSocket` 必須在 `serve()` 之後（順序反了會靜默失敗）
  - `@hono/node-ws` 是 Node.js 專用的 WS adapter，Bun/Deno 不需要
- **R10 Vite 開發與打包** ✅
  - 只有 Frontend 用 Vite（瀏覽器 bundle），Backend 用 tsc/tsx，Extension 用 esbuild/tsc
  - dev 模式：不打包，瀏覽器原生 ES modules，Vite server 按需轉譯
  - production build：Rollup 打包 + code splitting，dynamic import 自動拆成獨立 chunk
  - Shiki 語言 grammar 靠 `import('@shikijs/langs/xxx')` 動態載入，build 後每個語言一個 chunk
- **R11 IndexedDB API** ✅
  - 4 個 store：file-tree、file-content（24h TTL）、chat-sessions、git-status
  - 用 `idb` wrapper（比原生 API 簡潔），`openDB` + `put`/`get`/`delete`
  - vs localStorage：容量大（~幾百 MB）、非同步、支援任意 JS 物件
  - `upgrade` callback 只在版本號變化時執行，加 store 要升版本號
- **R12 PWA 基礎** ✅
  - 安裝條件：manifest.json（name/icons/display/start_url）+ HTTPS + Service Worker
  - `display: "standalone"` = 全螢幕無瀏覽器 UI → 沒有返回按鈕要自己做 swipe-back
  - MVP Service Worker 只為滿足安裝條件，離線快取交給 IndexedDB
  - Tailscale 內網非 HTTPS → 可能需要 Chrome flag 或 self-signed cert
- **R13 CSS mobile viewport** ✅
  - `env(safe-area-inset-top/bottom)` 處理 notch + home indicator，需 `viewport-fit=cover` 才生效
  - `touch-action: manipulation` 禁止雙擊縮放，消除 tap 的 300ms 延遲
  - `overscroll-behavior: contain` 禁止瀏覽器 pull-to-refresh，改用自建的

### Spike 計畫（B 類 Exit Questions 分群）

所有 B 類 Exit Questions 都是 [A]（AI 知道，用蘇格拉底問答帶），不需要 spike 實驗。

### [N]ice-to-know（不影響方向）
- Vitest 的 workspace 模式設定
- Lucide icon 的 tree-shaking 機制

## 6. 開工決策
- [x] 所有 [B]lock 已解除 ✅
- [x] [B]lock ≤ 3 個 ✅
- [x] Problem Statement 清晰 ✅
- [x] Solution Space 有比較過 ✅
- [x] 技術決策都有根據 ✅

**狀態**：可開工
