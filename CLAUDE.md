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

## Code Style

TypeScript 5.x across all 3 packages. Follow existing conventions.
