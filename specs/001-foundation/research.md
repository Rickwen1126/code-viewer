# 研究報告：Foundation

## 決策 1：Backend Runtime 與 WebSocket 方案

**決策**：Node.js 22 Alpine + `@hono/node-ws`

**理由**：
- Docker 環境下 Node.js 最成熟（image 小、tooling 完整）
- `@hono/node-ws` 是官方維護的 Node.js WebSocket adapter，底層用 `ws` package（與 Extension 端相同）
- Bun 的 pub/sub 雖更優雅，但 Docker tooling 較不成熟且 WebSocket API 耦合 runtime

**替代方案**：
- Bun：原生 WebSocket + pub/sub 更好，但 Docker Alpine image 不如 Node.js 穩定
- Deno：生態系較小，Hono adapter 支援度不如 Node.js

**關鍵限制**：CORS middleware 不可全域套用（`app.use('*', cors(...))`），必須只套在 `/api/*`，否則與 WebSocket upgrade headers 衝突。

## 決策 2：WebSocket 訊息協定

**決策**：JSON-RPC 2.0

**理由**：
- 標準化的 `id` 欄位天然支援 request/response 配對
- 區分 request（有 id）和 notification（無 id），適合 server-push 事件
- 人類可讀，debug 方便
- MCP 也使用相同協定

**替代方案**：
- 自訂 JSON `{ type, id, payload }`：需自己定義 error handling 規範
- Protobuf：效能更好但過度設計，本系統瓶頸在 LSP warmup（3-4s）而非序列化

**方法命名慣例**：slash 分隔的 namespace — `fs/readDirectory`, `lsp/definition`, `workspace/addFolder`

## 決策 3：語法高亮方案

**決策**：Shiki `core` + `createJavaScriptRegexEngine()` + Web Worker + `@tanstack/react-virtual`

**理由**：
- `shiki/core` 搭配 fine-grained `@shikijs/langs/<name>` 動態 import，只載入需要的語言
- `createJavaScriptRegexEngine()` 避免 ~600KB WASM binary（Oniguruma），啟動更快
- `codeToTokens()` 產生 token 陣列，搭配 virtual scrolling 只渲染可見行
- Web Worker 處理 tokenization，避免 main thread blocking（1000 行 TypeScript ~50-200ms）

**替代方案**：
- `react-shiki`：社群套件，API 方便但控制度不如 core
- `@shikijs/react`：官方但過度簡化，不支援 virtual scrolling
- 全文 `codeToHtml()`：對大檔案在手機上會卡頓

**Bundle 最佳化**：可用 `npx shiki-codegen` 在 build time 生成靜態 bundle。

## 決策 4：Extension WebSocket Bridge 架構

**決策**：
- `ws` npm package（esbuild bundle，externalize `bufferutil`/`utf-8-validate`）
- 指數退避重連（1s base, 2x factor, 60s max, ±20% jitter）
- Ping/Pong heartbeat（25s interval, 10s timeout）
- UUID-based PendingRequestMap 做 request/response 配對
- 實作 `vscode.Disposable` 確保 deactivate 時清理

**理由**：
- `ws` 已在實驗中驗證可用，esbuild bundle 是已知可行的做法
- Exponential backoff 避免 Extension Host restart 時對 Backend 造成衝擊
- Heartbeat 比 OS TCP keepalive 更快偵測 dead connection

**請求方向**：Backend → Extension（inbound request），Extension 回應。手機端 HTTP 請求到 Backend，Backend 透過 WebSocket forward 到 Extension。

## 決策 5：專案結構

**決策**：Monorepo，三個 top-level 目錄

```
extension/     ← VSCode Extension（WebSocket bridge + API 處理）
backend/       ← Hono Backend（REST API gateway + fallback）
frontend/      ← React Mobile Viewer
```

**理由**：
- 三個元件共享 protocol types（JSON-RPC message 定義）
- Monorepo 讓 1 人 + AI 團隊可以跨元件操作
- Docker Compose 在 root 統一管理三個 service

## 決策 6：測試策略

**決策**：Vitest（Backend + Frontend unit/integration） + Playwright（E2E mobile testing）

**理由**：
- Vitest 與 TypeScript + Vite 生態系整合最好
- Playwright 支援 mobile viewport simulation
- Extension 測試用 `@vscode/test-electron` 或直接在 Docker 中整合測試
