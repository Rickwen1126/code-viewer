---
name: codeview-dev
description: Start code-viewer in dev mode for developing/debugging code-viewer itself. Launches backend, frontend, and test-electron with the current repo.
---

# /codeview-dev — Dev Mode Startup

Start code-viewer's 3 services in development mode for working on code-viewer itself.

## Steps

1. **Kill stale processes** on ports 4800 and 4801:
   ```bash
   lsof -ti :4800 | xargs kill -9 2>/dev/null
   lsof -ti :4801 | xargs kill -9 2>/dev/null
   ```

2. **Install deps** (skip if node_modules fresh):
   ```bash
   pnpm install
   ```

3. **Build extension** (needed for test-electron):
   ```bash
   cd /Users/rickwen/code/code-viewer/extension && pnpm build
   ```

4. **Start backend** (background):
   ```bash
   pnpm --filter @code-viewer/backend dev > /tmp/codeview-backend.log 2>&1 &
   ```

5. **Start frontend** (background):
   ```bash
   pnpm --filter @code-viewer/frontend dev > /tmp/codeview-frontend.log 2>&1 &
   ```

6. **Wait for ports** — poll `lsof -i :4800 -i :4801` until both show LISTEN (timeout 15s).

7. **Launch test-electron** with `--real` mode (uses user's VS Code extensions, TS/LSP works):
   ```bash
   cd /Users/rickwen/code/code-viewer && node tests/e2e/launch-extension.mjs --real
   ```
   This opens a VS Code window with the extension loaded pointing at the current repo.

8. **Verify connection** — poll backend log for extension connected message (timeout 30s):
   ```bash
   grep -q "Extension connected.*code-viewer" /tmp/codeview-backend.log
   ```

9. **Report result**:
   - All 3 connected: "Dev mode ready. Frontend at http://localhost:4801"
   - Extension not connecting: check backend log, suggest manual connect via Command Palette

## Important Notes

- CWD must be project root (`/Users/rickwen/code/code-viewer`) for test-electron launch
- After changing extension code: `cd extension && pnpm build`, then reload the test-electron VS Code window
- Backend uses `tsx watch` — auto-reloads on backend code changes (sometimes needs manual restart)
- Frontend uses Vite HMR — auto-updates on frontend code changes
- test-electron `--real` mode uses 30min timeout, then VS Code closes automatically
- `--copilot` mode requires closing your own VS Code first (shares user-data-dir)
