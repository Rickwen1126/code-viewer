# Code Viewer — Development Guidelines

## Architecture

```
Desktop VS Code (Extension)  ─WS─  Backend (Hono relay :4800)  ─WS─  Frontend PWA (React :4801)
```

pnpm monorepo: `packages/shared`, `backend`, `extension`, `frontend`

## Ports

| Service | Port | Config |
|---------|------|--------|
| Backend | **4800** | `backend/src/index.ts` or `PORT` env |
| Frontend | **4801** | `frontend/vite.config.ts` |
| Extension | connects to `ws://localhost:4800` | VS Code setting `codeViewer.backendUrl` |

**Important**: User 的 VS Code User Settings 有 `codeViewer.backendUrl`，改 port 時須提醒 user 同步更新。

**Mobile 連線**: Frontend WS URL 自動從 `window.location.hostname` 取得，手機用 LAN IP 開前端即可（如 `http://192.168.x.x:4801`）。Backend port 4800 hardcoded 在 `main.tsx`，frontend 和 backend 必須在同一台機器。

## Quick Commands

```bash
pnpm install                    # install all deps
pnpm -r typecheck               # typecheck all packages
pnpm -w run test                 # run 166 unit tests (vitest)
pnpm -r build                   # build all packages
```

## Skills (自動化流程)

| Skill | 用途 |
|-------|------|
| `/codeview-dev` | 開發模式：啟動 backend + frontend + test-electron，用於改 code-viewer 本身 |
| `/codeview-start <path>` | 部署模式：Docker + VSIX，用於瀏覽任意 repo |
| `/e2e-test` | E2E checklist：8 項 Playwright 測試（iPhone 390x844） |

## Extension Behavior

- Extension 由 workspace setting `codeViewer.enabled` 控制（default: `false`）
- `enabled: false` → 完全靜默，不連線、不噴 log、零干擾
- `enabled: true` → 自動連線 `codeViewer.backendUrl`（default: `ws://localhost:4800`）
- Setting 變更即時生效（`onDidChangeConfiguration`），不需要 reload VS Code
- 手動連線：Command Palette → "Code Viewer: Connect to Backend"（不受 setting 限制）
- Setting 是 workspace 層級（`.vscode/settings.json`），不影響其他專案
- **Toggle trick**: 如果 VS Code 已開但 extension 沒連上，toggle setting（false → wait 2s → true）可觸發 reconnect

## Testing

- Mobile-first 產品，所有 UI 行為以手機尺寸為準
- Playwright E2E 測試必須用 iPhone viewport (390x844)

## Code Style

TypeScript 5.x across all 3 packages. Follow existing conventions.

## 踩坑紀錄

- **CWD 問題**: 在 `extension/` 下跑 build 後，Bash CWD 會留在 `extension/`。後續指令必須加 `cd /Users/rickwen/code/code-viewer &&` 確保從 project root 執行。
- **Extension build**: 改動 extension 後必須 `cd extension && pnpm build` rebuild（tsc + esbuild bundle）。
- **Extension VSIX 打包**: 必須用 `--no-dependencies`。pnpm monorepo 跟 `vsce package` 不相容。esbuild bundle 含 `ws` 等 runtime deps。
- **Backend restart**: `tsx watch` 通常自動 reload，但有時需手動 stop/start。
- **Frontend HMR**: Vite HMR 自動更新，但跨 Tailscale 的手機可能收不到，需手動刷新。
- **Safari iCloud 私密轉送**: 必須關閉，否則 WebSocket 連線失敗。
- **舊 port 殘留**: `lsof -i :4800` 檢查，`kill` 清掉。
- **`code` CLI env vars 不傳遞**: `code` CLI 開新視窗時 env vars 不傳（走 IPC）。改用 workspace setting 控制。
- **`code --extensionDevelopmentPath` folder 被丟棄**: VS Code 已在跑時，Extension Dev Host 開空視窗。改用 VSIX 安裝 + 正常開 VS Code。
- **Mac 權限**: 首次 `code` CLI 可能被 macOS 安全性攔截。
- **`fetch` 不保證在 Extension Host 可用**: 用 `require('http').get`。
