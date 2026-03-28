---
name: codeview-dev
description: "Start code-viewer in dev mode for developing/debugging code-viewer itself. Launches backend, frontend, and test-electron with the current repo. Triggers on: /codeview-dev"
---

# /codeview-dev — Dev Mode Startup

Start code-viewer's 3 services in development mode for working on code-viewer itself.

## Steps

1. **Kill stale processes** on ports 4800 and 4801:
   ```bash
   lsof -ti :4800 | xargs kill -9 2>/dev/null
   lsof -ti :4801 | xargs kill -9 2>/dev/null
   ```

2. **Build extension** (tsc + esbuild bundle):
   ```bash
   cd /Users/rickwen/code/code-viewer/extension && npx tsc && npx esbuild src/extension.ts --bundle --outfile=dist/extension.js --external:vscode --format=cjs --platform=node
   ```
   Note: `pnpm build` may fail if `esbuild` is not in PATH — always use `npx`.

3. **Start backend + frontend** (background, must disable sandbox):
   ```bash
   pnpm --filter @code-viewer/backend dev > /private/tmp/claude-501/codeview-backend.log 2>&1 &
   pnpm --filter @code-viewer/frontend dev > /private/tmp/claude-501/codeview-frontend.log 2>&1 &
   ```

4. **Wait for ports** — poll `lsof -i :4800 -i :4801` until both LISTEN (timeout 15s).

5. **Launch test-electron** with `--real` mode:
   ```bash
   cd /Users/rickwen/code/code-viewer && node tests/e2e/launch-extension.mjs --real
   ```

6. **Verify connection** — poll backend log (timeout 30s):
   ```bash
   grep "Extension connected.*code-viewer" /private/tmp/claude-501/codeview-backend.log
   ```

7. **Report**: "Dev mode ready. Frontend at http://localhost:4801"

## Gotchas

- CWD must be project root for test-electron
- After extension code changes: rebuild with step 2, then reload VS Code window
- `tsx watch` auto-reloads backend, but sometimes needs manual restart
- test-electron `--real` has 30min timeout
- `--copilot` mode requires closing your own VS Code first
