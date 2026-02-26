# SHIP: Code Viewer Foundation

tags: [ship, code-viewer, hono, vscode-extension, websocket, shiki]

## 1. Problem Statement

**問題**：在手機上瀏覽本地開發環境的程式碼（檔案樹 + 語法高亮），取代已下線的 Sourcegraph
**對象**：開發者自己（單人工具）
**成功條件**：手機開啟 → 選專案 → 看到檔案樹（<5s）→ 點檔案看到語法高亮的程式碼（<2s）

## 2. Solution Space

| 做法 | 優勢 | 風險/代價 |
|------|------|-----------|
| code-server Extension + Hono Backend + React Frontend（三層架構） | 最大化 VSCode API 能力，fallback 可離線用，前後端解耦 | 三個元件要協調，Extension Host 需瀏覽器連入才啟動 |
| 純 Backend 讀 FS + Frontend | 簡單，無 Extension 依賴 | 失去所有 LSP 能力，未來擴展受限 |
| code-server Web UI 直接用 | 零開發成本 | 手機體驗差，無法客製化，沒有 mobile-first UI |

**選擇**：三層架構（Extension + Hono + React）
**原因**：實驗已驗證 6/6 API 可行。三層架構為後續 LSP、Git、Tour 功能保留擴展性，且 fallback 機制讓 code-server 離線時仍可用。

## 3. 技術決策清單

| 決策點 | 選擇 | 原因 | 備選 |
|--------|------|------|------|
| Backend runtime | Node.js 22 Alpine + Hono | Docker tooling 最成熟，`@hono/node-ws` 官方維護 | Bun（WS 更好但 Docker 不穩）、Deno（生態小） |
| WS 協定 | JSON-RPC 2.0 | 標準 id 配對、人類可讀、MCP 也用 | 自訂 JSON（需自定義 error）、Protobuf（過度設計） |
| 語法高亮 | Shiki core + JS regex engine + Web Worker | 避免 600KB WASM，動態 import 語言包，Worker 不卡 UI | react-shiki（控制度低）、codeToHtml（手機卡頓） |
| Extension WS | `ws` npm（esbuild bundle）+ 指數退避 + heartbeat | 實驗驗證可行，bundle 是已知做法 | Extension Host 內建 WS（不存在） |
| 專案結構 | pnpm monorepo（extension/ backend/ frontend/ packages/protocol/） | 共享 JSON-RPC types，1人+AI 團隊跨元件操作方便 | 三個 repo（協調成本高） |
| 測試 | Vitest + Playwright | TypeScript 生態最佳整合，Playwright 支援 mobile viewport | Jest（較重）、Cypress（不支援 mobile） |

## 4. 橫向掃描

已在 Phase 0 研究中完成。Shiki 官方文件確認 `codeToTokens()` + virtual scrolling 是推薦的大檔案方案。`@hono/node-ws` 官方範例確認 WebSocket upgrade 整合模式。

## 5. 知識風險標記

### 前置過濾

**語法知識（自動 [N]）**：Hono route 寫法、Shiki API 呼叫、esbuild config、Docker Compose 語法、pnpm workspace 設定、Vitest/Playwright 設定、JSON-RPC message 格式、React component 寫法。這些全由 AI 處理。

**以下只標機制知識：**

### [B]lock（不理解，會影響方向判斷）

- [x] **HTTP → WebSocket Upgrade 機制（Hono 語境）**
  - 解什麼問題：WebSocket 借殼 HTTP GET 建立持久雙向管道，upgrade 後 HTTP 協定消失
  - 用錯會怎樣：CORS 放全域 → 101 response 被加多餘 header → client 拒絕連線，錯誤訊息還誤導去查 CORS
  - 為什麼選這做法：CORS 只套 /api/*，WebSocket 路由不經過 CORS middleware
  - 額外收穫：Hono 的 upgradeWebSocket() 是路由層 handler（不是提前攔截），所以它路徑上的 middleware 還是會跑到，設計路由時要注意
  - 狀態：✅ 已解除

### [B]lock（續）

- [x] **Extension Host 生命週期 + Disposable 資源管理**
  - 解什麼問題：Extension Host 是 code-server 的 child process，管理所有 Extension。activate 初始化一次，deactivate 不保證被呼叫
  - 用錯會怎樣：資源只寫在 deactivate 沒登記 Disposable → crash 時清理不到。TCP 連線 OS 會回收，但 timer/listener 會漏
  - 為什麼選這做法：Extension 當 WS client（不開 port），因為 Extension Host 是不穩定的被管理 process，Backend port 固定，重連邏輯簡單
  - 額外收穫：deactivate 做優雅清理（有順序），Disposable 做保底清理（粗暴但可靠），兩層都要有
  - 狀態：✅ 已解除

### [R]isky（大概懂但不確定）

- ✅ **PendingRequestMap：WebSocket 上的 request/response 配對**
  - 沒有 timeout → entry 永遠留在 map，closure 住整個 request context，導致 memory leak + 前端永遠 loading
  - 斷線清理順序：reject all pending → 關 WebSocket → 觸發重連。先清舊世界再開新世界，避免新舊 response 混配

### 學習計畫

所有 Exit Questions 都是 Type A（用戶不知道，AI 知道），不需要 spike 實驗。
透過心智模型建構 + 蘇格拉底問答解除。

**目標能力**：能對 AI 下架構指令（「這邊用 middleware 不對，應該...」）+ 能 review AI 產出的 code（「這個 dispose 少清了...」）。不需要會寫，但要能判斷對錯。

#### Session 1：Hono 心智模型（覆蓋 B1 + 部分 R1）

**前置錨定**：Express/Koa middleware 概念（或任何「request 進來 → 經過一串處理器 → response 出去」的模型）

1. **機制：Hono 是什麼、不是什麼**
   - Hono 在 Web framework 生態中的定位（vs Express, Fastify, Koa）
   - 核心設計取捨：Web Standards API（Request/Response）vs Node.js 專屬 API（req/res）
   - 多 runtime 支援的代價與好處（Node, Bun, Deno, Cloudflare Workers）
   - 為什麼我們選 Hono 而不是 Express？（輕量、TypeScript-first、adapter 模式）

2. **機制：Middleware pipeline 怎麼運作**
   - 洋蔥模型：request 進去 → middleware 層層包裹 → handler → response 層層回來
   - `app.use()` vs `app.get()` 的差別：全域攔截 vs 路由匹配
   - `next()` 的角色：為什麼不呼叫 next() 就會卡住
   - 故障模式：middleware 順序錯了會怎樣（CORS 放錯位置的真實案例）

3. **機制：HTTP → WebSocket Upgrade**
   - 一般 HTTP request/response 生命週期（短命、一問一答）
   - WebSocket handshake：為什麼它是一個「偽裝成 HTTP 的升級請求」
   - Upgrade 後 HTTP 消失：為什麼 CORS middleware 會衝突（它試圖對一個已經不是 HTTP 的連線設 header）
   - `@hono/node-ws` 的 `upgradeWebSocket()`：它在洋蔥模型的哪一層攔截、做了什麼

4. **設計取捨：為什麼 CORS 只套 /api/***
   - 用 Code Viewer 的實際架構解釋：`/api/*` 是 REST（需要 CORS）、`/ws/*` 是 WebSocket（不需要也不能有 CORS）
   - 如果搞錯了會怎樣：WebSocket 連不上，但錯誤訊息可能是 CORS error，很難 debug

**→ Exit Questions B1 Q1-Q3 驗證**

#### Session 2：Extension Host 心智模型（覆蓋 B2 + 部分 R1）

**前置錨定**：OS process 概念（主 process fork 出子 process、子 process 有自己的記憶體空間、主 process 死了子 process 可能變 orphan）

1. **機制：code-server 的 process 架構**
   - 三層 process：code-server (main) → Extension Host (child process) → 各個 Extension（同一 process 內的不同模組）
   - 類比：code-server 是餐廳經理，Extension Host 是廚房，各 Extension 是廚師。經理不在廚房還能運作一陣子，但沒有經理最終廚房會關門。
   - 為什麼瀏覽器關掉 Extension Host 還活著（它是獨立 process，不是瀏覽器 tab 裡的 JS）
   - 什麼時候 Extension Host 會死：session timeout、server 重啟、手動殺

2. **機制：Extension 生命週期（activate / deactivate）**
   - `activate()`：Extension Host 載入你的 extension 時呼叫一次。不是「每次有人用你的功能」都呼叫。
   - `deactivate()`：Extension Host 準備關閉時呼叫。但 **不保證一定會被呼叫**（crash、kill -9）。
   - 類比：activate = 廚師上班打卡，deactivate = 下班打卡。但如果餐廳突然失火（crash），沒人會先去打卡。
   - 故障模式：如果 activate 建了 WebSocket 但 deactivate 沒關 → zombie connection（Backend 以為 Extension 還在，但其實 process 已死）

3. **機制：Disposable pattern — 為什麼不能只靠 deactivate**
   - 問題：deactivate 不保證被呼叫。那資源怎麼清理？
   - Disposable 是 VSCode 的「自動清理契約」：你把東西登記到 `context.subscriptions`，Extension Host 關閉時「不管你的 deactivate 有沒有跑」都會幫你清。
   - 類比：你可以自己下班前關瓦斯（deactivate），但你也應該裝自動斷瓦斯的定時器（Disposable）。失火時定時器救你。
   - 在 Code Viewer 中的實際意義：`bridge-client.ts` 的 WebSocket client 必須是 Disposable，否則 Extension Host 異常關閉時 WebSocket 不會被正確關閉。

4. **設計取捨：為什麼 Extension 只當 WebSocket client，不開 port**
   - Extension Host 是被管理的 process，沒有穩定的網路身份（port 可能變、process 可能重啟）
   - 讓 Backend 是 server（穩定的 port），Extension 是 client（主動連出去），重連邏輯簡單
   - 如果反過來（Extension 開 port）：Backend 怎麼知道 Extension 在哪？port 衝突怎麼辦？Extension restart 後 port 變了怎麼辦？

**→ Exit Questions B2 Q1-Q3 驗證**

#### Session 3：PendingRequestMap + 整合（覆蓋 R1）

**前置錨定**：Session 1-2 已建立的 WebSocket + Extension 模型

1. **機制：為什麼 WebSocket 需要自己做 request/response 配對**
   - HTTP 天生是 request→response（一問一答，自動配對）
   - WebSocket 是雙向管道：你丟訊息進去，對面丟訊息回來，但沒有內建的「這個回應是對應哪個請求」
   - JSON-RPC 2.0 的 `id` 欄位就是解法：送出時帶 UUID，回來時比對 UUID

2. **故障模式：沒有 timeout 和斷線清理會怎樣**
   - Memory leak：pending map 越長越大，GC 回收不了（因為有 reference 指著 callback）
   - 呼叫端永遠等不到回應：前端使用者看到無限 loading
   - 斷線清理順序：先 reject 所有 pending → 再關 WebSocket → 再觸發重連。順序錯了可能重連後收到舊 response 配到新 request

**→ Exit Questions R1 Q1-Q2 驗證**

### [N]ice-to-know（不影響方向）

- Shiki tokenization 內部如何分詞（JS regex engine vs Oniguruma 的差異細節）
- Web Worker postMessage 序列化機制
- @tanstack/react-virtual 的 virtualization 演算法
- pnpm workspace resolution 規則
- Docker multi-stage build 最佳化

## 6. 開工決策

- [x] 所有 [B]lock 已解除（2/2）
- [x] [B]lock ≤ 3 個（2 個）
- [x] Problem Statement 清晰
- [x] Solution Space 有比較過
- [x] 技術決策都有根據（6 個決策全在 research.md 有理由和備選方案）

**狀態**：✅ 可開工
