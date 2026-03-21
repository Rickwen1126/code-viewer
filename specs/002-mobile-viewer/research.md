# Phase 0 Research: Mobile Code Viewer

**Branch**: `002-mobile-viewer` | **Date**: 2026-03-14
**Input**: Technical Context from [plan.md](./plan.md)

---

## R1. Hono WebSocket 支援與多連線管理

### Decision
採用 Hono + `@hono/node-ws` 在 Node.js 上運行，手動管理 WS 連線（Map-based session routing）。

### Rationale
- Hono v4+ 內建 `upgradeWebSocket()` helper，統一所有 runtime 的 WS 升級介面
- `@hono/node-ws` 為 Node.js 專用 adapter，底層使用 `ws` 套件
- Hono 可在同一 app 中混合 HTTP routes 和 WS routes，滿足健康檢查 + WS relay 並存需求
- 無內建 room/session 概念，但我們只需 Map-based 管理（key = extension ID / frontend session）

### Alternatives Considered
- **Bun 原生 WS**: 效能最好但 Bun 生態較不成熟，且部署環境偏好 Node.js
- **Deno**: WS 支援良好但團隊較少使用
- **純 ws + Express**: 失去 Hono 的 middleware 生態和 TypeScript-first 設計
- **Cloudflare Workers**: 不適合長連線 relay，有 CPU 時間限制
- **Socket.IO**: 過重，我們不需要 fallback transport 或 namespace 功能

### Key Findings

1. **Hono WS API**: `upgradeWebSocket()` 回傳 handler 物件，包含 `onOpen`、`onMessage`、`onClose`、`onError` 事件。透過 `c.env` 或 closure 存取連線狀態。

2. **Runtime 選擇**: Node.js（`@hono/node-ws`）最適合我們的場景 — 長時間 WS 連線、記憶體快取。
   Bun 雖然原生 WS 效能更好，但 Node.js 生態更穩定。

3. **HTTP + WS 共存**: Hono 原生支援。WS route 是 `app.get('/ws', upgradeWebSocket(...))`，
   HTTP route 照常 `app.get('/api/health', ...)`。

4. **多連線管理**: 需手動實作。推薦 pattern：
   ```
   Map<extensionId, WebSocket>  // Extension 連線池
   Map<sessionId, { extensionId, frontendWs }>  // Session routing
   ```
   Extension 連線時帶 `extensionId`（workspace name + path hash），
   Frontend 連線時指定要連哪個 extension。

5. **Node.js 注意事項**:
   - `@hono/node-ws` 需要搭配 `@hono/node-server` 使用
   - **`injectWebSocket(server)` MUST 在 `serve()` 之後呼叫**，否則 upgrade 靜默失敗
   - 需手動實作 ping/pong heartbeat（Hono 無內建）

6. **Heartbeat**: Hono 不提供內建 heartbeat。透過 `ws.raw` 存取底層 `ws` 實例：
   - 每 30s server → client ping（`rawWs.ping()`）
   - 40s 無 pong → 標記 stale；stale 5min 無重連 → 移除（見 ws-protocol.md 最終規格）
   - Extension 端用 `ws` 套件的 `ping()` / `on('pong')` API

7. **⚠️ Critical Gotchas**:
   - **Async 回呼掉訊息**: `upgradeWebSocket((c) => { ... })` 內 MUST NOT `await`，
     否則早期訊息被丟棄（`wss.handleUpgrade` 先於 async event 綁定觸發）。
     解法：async 邏輯放到前置 middleware 或 `onOpen` handler 內。
   - **CORS 衝突**: `upgradeWebSocket()` 內部修改 response headers，
     若全域套用 `cors()` middleware 會觸發 "Headers are immutable" 錯誤。
     解法：WS route 不套用 CORS middleware，只對 HTTP route 套用。

---

## R2. Shiki 語法高亮行動端效能

### Decision
採用 Shiki v2 + `@shikijs/engine-javascript`（純 JS engine）+ fine-grained bundle +
`react-shiki` 元件 + Web Worker 分離高亮運算。大檔案（>500 行）搭配虛擬化。

### Rationale
- Shiki 使用 VS Code 同款 TextMate grammar，高亮精度最高，與 Desktop VS Code 一致
- JS engine 不需要 WASM，bundle 更小、啟動更快
- Fine-grained bundle 只載入實際需要的語言和主題
- Web Worker 避免大檔案高亮阻塞 main thread
- `react-shiki` 提供 React-friendly API（component + hook）

### Alternatives Considered
- **Prism.js**: 更輕量但精度較低，不支援 VS Code 主題
- **highlight.js**: 效能最好（44x faster）但精度不如 Shiki
- **Shiki + Oniguruma engine**: 精度最高但需載入 WASM（622KB gzip），行動端首次載入慢
- **Server-side highlighting**: 在 Extension 端做高亮再傳 HTML，但增加網路傳輸量（3-5x）

### Key Findings

1. **Shiki v2 架構**: 引入 Engine System — `@shikijs/engine-oniguruma`（WASM, 預設）和 `@shikijs/engine-javascript`（純 JS）。JS engine v3.9.1 起已支援所有內建語言，不需 WASM。

2. **行動端效能推估**（Desktop 3.5-5ms/block, mobile 3-5x slower）:
   - 100 行：即時（~10-25ms）
   - 500 行：可接受（~50-125ms），建議 Web Worker
   - 1000 行：需要 Web Worker（~100-250ms）
   - 5000+ 行：必須搭配虛擬化 + Worker（~500-1250ms）
   - **DOM 渲染是更大的瓶頸** — 1000 行可產生 5000-15000 span 元素

3. **虛擬化閾值**: 建議 **300 行以上**即啟用虛擬化（行動端 DOM 渲染瓶頸）。
   - 推薦 `react-virtuoso`（自動高度測量，variable-height rows 支援更好）
   - 備選 `@tanstack/react-virtual`（更輕量但需手動管理行高）
   - 先高亮可視區域的行，用 Web Worker 背景高亮其餘行
   - **快取已高亮結果**，避免重複 tokenization

4. **主題載入**: 可透過 `import('@shikijs/themes/dark-plus')` 動態載入單一主題。
   支援 CSS variables mode，可在不重新高亮的情況下切換深色/淺色。

5. **Bundle 大小**（fine-grained + JS engine）:
   - Shiki core: ~28KB gzipped
   - JS engine: ~10-15KB gzipped（無 WASM）
   - 語言 grammars（5-8 種）: ~50-80KB gzipped（TSX ~17KB, JSON ~5KB）
   - 主題: ~10KB gzipped
   - **總計: ~100-135KB gzipped** — 行動端可接受

6. **react-shiki**: 提供 `ShikiHighlighter` component 和 `useShikiHighlighter` hook。
   支援 `delay` prop 做 throttling。Core bundle ~12KB gzipped。
   但若需虛擬化，建議直接用 `shiki/core` + `codeToTokens()` 做 per-line tokenization。

7. **Web Worker 策略**: Shiki 官方建議把高亮運算放到 Web Worker。
   Highlighter instance 建立成本高，MUST 建立 singleton 重用 + `dispose()` 釋放。

---

## R3. React 行動端導航（Tab Bar + Stack + Swipe-Back）

### Decision
採用 React Router v7 做路由 + React 19.2 `<Activity>` 做 tab state 保持 +
View Transitions API 做頁面動畫 + `react-swipeable` 做 swipe-back。
不使用 Ionic React（避免大型框架依賴和設計系統綁定）。

### Rationale
- React Router v7 是最成熟的 React 路由方案，支援 nested layouts
- React 19.2 `<Activity>` 原生解決 tab state 保持問題（之前最大痛點）
- View Transitions API 已達 Baseline（2025/10），Chrome/Safari/Firefox 全支援
- `react-swipeable`（~1.5KB）比手動 touch event 更可靠
- 自建 Tab Bar 最靈活，且避免 Ionic 的設計系統綁定

### Alternatives Considered
- **Ionic React**: Tab+Stack 導航最完整的方案，內建 swipe-back 和 native-like 動畫。
  但加入 ~80-120KB bundle、引入 Ionic 設計系統綁定、且 iOS PWA standalone 模式有
  已知 swipe-back bug（#29733）。適合快速原型但不適合我們的 Dark Terminal Luxury 設計方向。
- **Framework7 React**: 最佳 iOS native-feel，但需替換 React Router 為自家路由系統
- **TanStack Router**: 型別安全但缺乏 tab keep-alive 支援（discussion #1447 未解決）
- **Motion (Framer Motion)**: 適合 swipe-back 手勢動畫（~15-30KB），
  View Transitions API 不支援 interruptible gesture 時可作為 fallback

### Key Findings

1. **React Router v7 + Nested Routes**: 用 `<Outlet>` 實作 tab layout，每個 tab 是 nested route。
   ```
   / → TabLayout
   ├── /workspaces → WorkspacesTab
   ├── /files → FilesTab
   │   └── /files/:path → CodeViewer
   ├── /git → GitTab
   │   └── /git/diff/:file → DiffViewer
   ├── /tours → ToursTab
   │   └── /tours/:id → TourDetail
   ├── /chat → ChatTab
   │   └── /chat/:sessionId → Conversation
   └── /review → ReviewTab
       └── /review/:fileId → EditReview
   ```

2. **Per-tab State 保持 — React 19.2 `<Activity>`**:
   - React 19.2 的 `<Activity mode="visible"|"hidden">` 保持子元件 mounted 但隱藏
   - 隱藏時保留 DOM 節點、scroll position、state，但 unmount side effects
   - 完美解決 tab 切換時的 state 保持問題
   - 用法：每個 tab 包在 `<Activity mode={isActive ? "visible" : "hidden"}>` 內
   - **依賴 React 19.2+**，需確認專案 React 版本

3. **Swipe-Back 手勢**: 使用 `react-swipeable`（~1.5KB）：
   - 偵測左邊緣 20px 內的 right-swipe
   - 移動量 > 100px 且速度達標觸發 `navigate(-1)`
   - `transform: translateX()` + `transition` 做動畫
   - **注意**：iOS standalone PWA 模式沒有原生 swipe-back，MUST 自行實作
   - 程式碼區域水平滾動與 swipe-back 手勢衝突 → 限制在左邊緣觸發

4. **View Transitions API**: Baseline 2025/10，Chrome 111+ / Safari 18+ / Firefox 133+。
   React 提供 `<ViewTransition>` component，React Router v7 支援 `viewTransition` prop。
   ```
   Stack push: slide-in-right / Stack pop: slide-out-right
   Tab switch: crossfade（瞬間切換感）
   ```
   對於需要 interruptible 的手勢動畫，View Transitions 不夠 → 用 Motion 補充。

5. **Safe Area**: PWA 需處理 notch 和 home indicator。
   ```css
   padding-top: env(safe-area-inset-top);
   padding-bottom: env(safe-area-inset-bottom);
   ```
   Tab Bar 固定在 `bottom: 0` + `padding-bottom: env(safe-area-inset-bottom)`。

6. **Pull-to-Refresh**: PWA 的 overscroll 行為需用 CSS 控制：
   ```css
   html { overscroll-behavior-y: contain; }
   ```
   自建 pull-to-refresh 用 touch event + `transform: translateY()`。

7. **Tab Bar 設計**: 6 個 tab 在 iPhone（402px 寬）每個約 67px 寬。
   最小觸控目標 44x44pt 滿足。建議高度 56px + bottom safe area。
   用 Lucide icons（24px）+ 10px 文字標籤。

---

## R4. Diff 渲染方案（觸控 + Shiki 整合）

### Decision
分層策略：先評估 `react-diff-viewer-continued`（render prop 接 Shiki），
若不滿足則自建。Diff 演算法用 `jsdiff`，虛擬化用 `@tanstack/react-virtual`，
手勢用 `motion`（Framer Motion）。

### Rationale
- `react-diff-viewer-continued` 是最成熟的選擇（478K weekly downloads, v4.2.0），
  其 `renderContent` render prop 可插入 Shiki 語法高亮
- 但 React 19 peer dependency 問題尚未解決（issue #63），需測試
- 若 render prop 無法滿足 hunk-level approve/reject 互動，再自建
- 自建部分用成熟 primitives（jsdiff + Shiki + TanStack Virtual + Motion）

### Alternatives Considered
- **@pierre/diffs**: 基於 Shiki，有 annotation framework。v1（2026 初），
  較新但值得作為第二候選。annotation 可能可用於 approve/reject UI。
- **@git-diff-view/react + @git-diff-view/shiki**: 一流 Shiki 支援，
  但 1.29MB bundle 太重、v0.0.x 不穩定。
- **react-diff-view**: 架構最靈活（renderToken, withChangeSelect），
  但 Shiki 整合需要寫 adapter，且維護頻率下降。
- **diff2html**: HTML 輸出為主，不適合 React 元件化和觸控互動
- **Monaco Editor diff**: 太重（2-4MB），不適合行動端

### Key Findings

1. **Diff 演算法**: `diff`（jsdiff）是最推薦的 JS diff library。
   - `Diff.diffLines()` 做行級 diff
   - `Diff.structuredPatch()` 產生含 hunk 資訊的結構化輸出
   - Myers 演算法實現，支援 async 模式（大檔案用）

2. **Shiki + Diff 整合策略**:
   - 用 jsdiff 計算出 hunks（新增/刪除/不變的行）
   - 對整個檔案（新/舊版本）分別用 Shiki 高亮
   - 將 Shiki 的 token 化結果對應到 diff 的行，組合成語法高亮的 diff
   - 這樣確保高亮與檔案瀏覽完全一致

3. **行動端 Unified vs Split**:
   - **Unified view** 在窄螢幕（402px）上明顯更適合
   - Split view 每邊只有 ~190px，程式碼被截斷太嚴重
   - 建議預設 unified，進階使用者可手動切換 split（橫向捲動）

4. **Hunk-level Approve/Reject UI**:
   - 每個 hunk 右上角顯示 approve/reject 按鈕組
   - Swipe-right on hunk = approve, swipe-left = reject（tinder 式互動）
   - 但 swipe 可能與程式碼水平捲動衝突 → 預設用按鈕，swipe 作為 enhancement

5. **大 Diff 虛擬化**: 用 `@tanstack/react-virtual` 做行級虛擬化。
   只渲染可視區域的 diff 行。

6. **File-level 切換**: 多檔案 diff 用底部 horizontal scrollable list 或 swipe-between-files。
   用 Swiper.js 或手動 touch event 實作。

---

## Research Summary

| 領域 | 決策 | 風險等級 |
|------|------|---------|
| Backend WS | Hono + @hono/node-ws + Map-based routing | 低 |
| 語法高亮 | Shiki v2 + JS engine + react-shiki + Web Worker | 低 |
| 行動導航 | React Router v7 + 自建 Tab Bar + View Transitions | 中（自建量較多）|
| Diff 渲染 | jsdiff + Shiki + 自建元件 | 中（自建量較多）|

**整體風險評估**：主要風險在 R3 和 R4 的自建元件量。
但考慮到行動觸控場景的特殊性，現有 library 確實無法滿足需求，
自建是合理決策。建議 Phase 2 任務中把導航骨架和 diff 元件作為早期 milestone，
以盡早驗證觸控互動品質。
