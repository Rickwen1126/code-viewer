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

## Commands

```bash
pnpm install                    # install all deps
pnpm -r typecheck               # typecheck all packages
pnpm -w run test                 # run 166 unit tests (vitest)
pnpm -r build                   # build all packages
```

## Dev Startup (3 terminals)

```bash
pnpm --filter @code-viewer/backend dev     # Terminal 1: Backend relay
pnpm --filter @code-viewer/frontend dev    # Terminal 2: Frontend Vite
# Terminal 3: VS Code F5 → "Run Extension" (needs .vscode/launch.json)
```

## E2E Test

```bash
# Step 1: Start backend + frontend
pnpm --filter @code-viewer/backend dev &
pnpm --filter @code-viewer/frontend dev &

# Step 2: Launch VS Code with extension (pick a mode)
node tests/e2e/launch-extension.mjs                  # lightweight (fast, no TS/LSP)
node tests/e2e/launch-extension.mjs --real            # real (user's extensions, TS/LSP works)
node tests/e2e/launch-extension.mjs --real --copilot  # full (+ Copilot auth, CLOSE your VS Code first!)

# Optional: specify a different workspace
node tests/e2e/launch-extension.mjs --real /path/to/other/project

# Step 3: Playwright tests against frontend (while VS Code is alive)
npx playwright test tests/e2e/
```

**Note**: `--copilot` 模式會讀取你的 VS Code user-data-dir（含 Copilot 登入 token），必須先關閉你自己的 VS Code 實體避免衝突。

## Testing

- Playwright E2E 測試必須用 iPhone viewport (390x844) 執行
- 這是 mobile-first 產品，所有 UI 行為以手機尺寸為準

## Operational Notes

- **CWD 問題**: 在 `extension/` 下跑 `tsc` build 後，Bash CWD 會留在 `extension/`。後續指令（如 `node tests/e2e/launch-extension.mjs`）必須加 `cd /Users/rickwen/code/code-viewer &&` 確保從 project root 執行。
- **Extension build**: 改動 extension 後必須 `cd extension && node_modules/.bin/tsc` rebuild，再重啟 VS Code test instance。
- **Backend restart**: 改動 `backend/src/ws/handler.ts` 等 backend 檔案後，需重啟 backend（`tsx watch` 會自動 reload，但有時需手動 stop/start）。
- **Frontend HMR**: 改動 frontend 後 Vite HMR 自動更新，但跨 Tailscale 的手機可能收不到 HMR，需手動刷新。
- **Safari iCloud 私密轉送**: 必須關閉，否則 WebSocket 連線會失敗。詳見 README Known Issues。
- **舊 port 殘留**: 確認沒有舊的 Vite dev server 跑在 5847/5848（`lsof -i :5847` 檢查，`kill` 清掉）。

## Code Style

TypeScript 5.x across all 3 packages. Follow existing conventions.
