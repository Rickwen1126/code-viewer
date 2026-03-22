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

## Extension Behavior

- Extension 由 workspace setting `codeViewer.enabled` 控制（default: `false`）
- `enabled: false` → 完全靜默，不連線、不噴 log、零干擾
- `enabled: true` → 自動連線 `codeViewer.backendUrl`（default: `ws://localhost:4800`）
- Setting 變更即時生效（`onDidChangeConfiguration`），不需要 reload VS Code
- CLI 自動寫入 `.vscode/settings.json`：`{ "codeViewer.enabled": true }`
- 手動連線：Command Palette → "Code Viewer: Connect to Backend"（不受 setting 限制）
- Setting 是 workspace 層級（`.vscode/settings.json`），不影響其他專案

## Deployment (CLI)

```bash
# 前置：安裝 extension（一次性）
cd extension && npx vsce package --no-dependencies
code --install-extension code-viewer-0.0.1.vsix

# 啟動
code-viewer start ~/code/my-project
# 做了什麼：
# 1. docker compose up -d (backend:4800 + frontend:4801)
# 2. 寫入 .vscode/settings.json: { "codeViewer.enabled": true }
# 3. code ~/code/my-project

# 多 repo
code-viewer start ~/code/project-a
code-viewer start ~/code/project-b     # 每個 workspace 獨立 setting

# 停止
code-viewer stop                       # docker compose down
```

**注意**：`code` CLI 需要在 PATH 裡。VS Code → Cmd+Shift+P → "Shell Command: Install 'code' command in PATH"

## Operational Notes

- **CWD 問題**: 在 `extension/` 下跑 `tsc` build 後，Bash CWD 會留在 `extension/`。後續指令（如 `node tests/e2e/launch-extension.mjs`）必須加 `cd /Users/rickwen/code/code-viewer &&` 確保從 project root 執行。
- **Extension build**: 改動 extension 後必須 `cd extension && pnpm build` rebuild（tsc + esbuild bundle）。
- **Extension VSIX 打包**: 必須用 esbuild bundle（`--bundle --external:vscode`）才能包含 `ws` 等 runtime dependencies。pnpm monorepo 跟 `vsce package`（不加 `--no-dependencies`）不相容。打包指令：`cd extension && vsce package --no-dependencies`。
- **Backend restart**: 改動 `backend/src/ws/handler.ts` 等 backend 檔案後，需重啟 backend（`tsx watch` 會自動 reload，但有時需手動 stop/start）。
- **Frontend HMR**: 改動 frontend 後 Vite HMR 自動更新，但跨 Tailscale 的手機可能收不到 HMR，需手動刷新。
- **Safari iCloud 私密轉送**: 必須關閉，否則 WebSocket 連線會失敗。詳見 README Known Issues。
- **舊 port 殘留**: 確認沒有舊的 Vite dev server 跑在 5847/5848（`lsof -i :5847` 檢查，`kill` 清掉）。
- **`code` CLI 環境變數不傳遞**: `code` CLI 開新視窗時，env vars 不會傳到 VS Code process（走 IPC 給已在跑的實例）。所以改用 workspace setting 控制連線。
- **`code --extensionDevelopmentPath` folder 會被丟棄**: 如果 VS Code 已在跑，Extension Dev Host 可能開空視窗（folder 被 `findWindowOnWorkspaceOrFolder` 過濾掉）。改用 VSIX 安裝 + 正常開 VS Code。
- **Mac 權限**: 首次用 `code` CLI 從 terminal 開 VS Code 可能被 macOS 安全性攔截，需手動授權。
- **`fetch` 不保證在 Extension Host 可用**: 如需 HTTP 呼叫用 `require('http').get`。

## E2E Checklist (per workspace)

每次重大改動後用 Playwright 跑完整 checklist（iPhone viewport 390x844）：

| # | Test | 驗證方式 |
|---|------|---------|
| 1 | 選 workspace → file tree 載入 | 檔案/目錄結構正確 |
| 2 | 開檔案 → syntax highlight + 行號 | language label + 行號連續 |
| 3 | 返回 file tree → 展開狀態保留 | 之前展開的目錄還在 |
| 4 | 搜尋功能 | 輸入關鍵字 → 結果正確 |
| 5 | Recent files | search focus → 顯示最近開過的檔案 |
| 6 | Git → branch + changed files | branch name + staged/unstaged 分組 |
| 7 | Git → commit history 展開 | 點 commit → file list → 點 file → diff |
| 8 | Workspace 切換 → 資料正確切換 | 不同 repo 的檔案/branch/commits 完全獨立 |

多 repo 測試須至少 2 個不同 workspace 驗證 #8。

## Code Style

TypeScript 5.x across all 3 packages. Follow existing conventions.
