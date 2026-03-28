---
name: codeview-dev
description: "Start code-viewer in dev mode for developing/debugging code-viewer itself. Launches backend, frontend, and test-electron with the current repo. Triggers on: /codeview-dev"
---

# /codeview-dev — Dev Mode Startup

Start code-viewer's 3 services in development mode for working on code-viewer itself.

## Steps

1. **Kill stale code-viewer processes** on ports 4800 and 4801:
   ```bash
   # Get PIDs listening on each port
   BACKEND_PID=$(lsof -ti :4800 2>/dev/null)
   FRONTEND_PID=$(lsof -ti :4801 2>/dev/null)
   ```
   For each PID found, verify it belongs to code-viewer before killing:
   ```bash
   ps -p $PID -o command= 2>/dev/null | grep -q "code-viewer"
   ```
   - If code-viewer process -> kill it (we want fresh restart for dev)
   - If NON-code-viewer process -> **report conflict**, do NOT kill

2. **Build extension if source changed** (test-electron loads from local `dist/`, not installed VSIX):
   ```bash
   find /Users/rickwen/code/code-viewer/extension/src -name "*.ts" -newer /Users/rickwen/code/code-viewer/extension/dist/extension.js 2>/dev/null | head -1
   ```
   If any source files are newer than `dist/extension.js` -> rebuild:
   ```bash
   cd /Users/rickwen/code/code-viewer/extension && npx tsc && npx esbuild src/extension.ts --bundle --outfile=dist/extension.js --external:vscode --format=cjs --platform=node
   ```
   If up-to-date -> skip.
   Note: No VSIX packaging or version bump needed — dev mode loads from local dist directly.

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
   Mode semantics:
   - `--real` = use installed VS Code binary + `~/.vscode/extensions`
   - `--real` != your full daily VS Code profile/session (it does **not** load `~/Library/Application Support/Code`)
   - `--copilot` adds `--user-data-dir`, which is the mode that touches your normal VS Code profile and requires your own VS Code to be closed
   - For code-viewer E2E that depends on extension/backend/LSP round-trip, prefer `--real`
   - Use lightweight mode only for deliberate pure-frontend smoke checks, and report that limitation explicitly

6. **Verify connection** — poll backend log (timeout 30s):
   ```bash
   grep "Extension connected.*code-viewer" /private/tmp/claude-501/codeview-backend.log
   ```

7. **Report**: "Dev mode ready. Frontend at http://localhost:4801"

## Gotchas

- CWD must be project root for test-electron
- After extension code changes: rebuild with step 2, then reload VS Code window
- Before trusting any E2E result, confirm the running extension host was launched **after** the latest `dist/extension.js` build
- `tsx watch` auto-reloads backend, but sometimes needs manual restart
- test-electron `--real` has 30min timeout
- `--copilot` mode requires closing your own VS Code first
