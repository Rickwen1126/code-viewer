# Quick Start: Mobile Code Viewer

**Branch**: `001-mobile-viewer` | **Date**: 2026-03-14

---

## 環境需求

- Node.js 20+
- pnpm 9+
- VS Code Desktop（已安裝 Code Viewer Bridge Extension）
- Tailscale（手機與電腦在同一 tailnet）

## 啟動步驟

### 1. 安裝依賴

```bash
pnpm install
```

### 2. 啟動 Backend

```bash
cd backend
pnpm dev
# → http://0.0.0.0:9900
# → ws://0.0.0.0:9900/ws/extension (Extension 端點)
# → ws://0.0.0.0:9900/ws/frontend  (Frontend 端點)
```

### 3. 安裝 Extension

```bash
cd extension
pnpm build
pnpm package
code --install-extension code-viewer-bridge-*.vsix
```

VS Code 重載後，Extension 自動連線到 Backend。

### 4. 啟動 Frontend

```bash
cd frontend
pnpm dev
# → http://localhost:5173
```

手機上透過 Tailscale IP 存取：`http://{TAILSCALE_IP}:5173`

### 5. 驗證連線

1. 開啟手機瀏覽器 → `http://{TAILSCALE_IP}:5173`
2. 應看到 Workspace Selector 畫面
3. 列出目前已連線的 VS Code 實體
4. 選擇一個 → 進入檔案瀏覽

## 開發指令

| 指令 | 說明 |
|------|------|
| `pnpm dev` | 啟動對應 package 的 dev server |
| `pnpm build` | 建置 production bundle |
| `pnpm test` | 執行 Vitest 測試 |
| `pnpm lint` | ESLint 檢查 |
| `pnpm typecheck` | TypeScript 型別檢查 |

## Monorepo 結構

```
packages/shared/    → 共用型別（ws-types.ts, models.ts）
extension/          → VS Code Extension（WS client）
backend/            → Hono WS relay server
frontend/           → React mobile PWA
```

## 環境變數

### Backend (`backend/.env`)

```
PORT=9900
HOST=0.0.0.0
```

### Extension（VS Code settings）

```json
{
  "codeViewer.backendUrl": "ws://localhost:9900/ws/extension"
}
```

### Frontend (`frontend/.env`)

```
VITE_BACKEND_WS_URL=ws://localhost:9900/ws/frontend
```

## 常見問題

**Q: Extension 連不上 Backend？**
A: 確認 Backend 正在執行，且 `codeViewer.backendUrl` 設定正確。

**Q: 手機連不上 Frontend？**
A: 確認手機和電腦在同一 Tailscale tailnet，用 Tailscale IP 而非 localhost。

**Q: 語法高亮第一次很慢？**
A: Shiki 需要載入語言 grammar，首次載入 ~200ms。之後同語言會快取。
