---
name: codeview-start
description: "Start code-viewer to browse any repo. Takes one or more repo paths. Checks VSIX installed, starts backend/frontend if not running, opens VS Code for each repo, verifies all connections. Triggers on: /codeview-start <path> [path2 ...]"
---

# /codeview-start — View Repos

Start code-viewer to browse repos from mobile/browser. Supports multiple repos in one command.

## Arguments

- `<repo-path>` — one or more repo paths. If omitted, ask the user.
- Example: `/codeview-start ~/code/chatpilot ~/code/code-viewer`

## Steps

### Phase 1: Prerequisites

1. **Check VSIX installed**:
   ```bash
   code --list-extensions 2>/dev/null | grep -qi "code-viewer"
   ```
   If NOT installed, build and install:
   ```bash
   cd /Users/rickwen/code/code-viewer/extension && npx tsc && npx esbuild src/extension.ts --bundle --outfile=dist/extension.js --external:vscode --format=cjs --platform=node && npx vsce package --no-dependencies && code --install-extension code-viewer-extension-0.0.1.vsix
   ```

2. **Check if services already running** on ports 4800 + 4801:
   ```bash
   lsof -i :4800 -i :4801 2>/dev/null | grep LISTEN
   ```
   - If both LISTEN → skip to Phase 2
   - If ports used by something else → report conflict
   - If not running → start services

3. **Start backend + frontend** (dev mode, must disable sandbox):
   ```bash
   lsof -ti :4800 | xargs kill -9 2>/dev/null
   lsof -ti :4801 | xargs kill -9 2>/dev/null
   pnpm --filter @code-viewer/backend dev > /private/tmp/claude-501/codeview-backend.log 2>&1 &
   pnpm --filter @code-viewer/frontend dev > /private/tmp/claude-501/codeview-frontend.log 2>&1 &
   ```
   Wait for both ports LISTEN (timeout 15s).

### Phase 2: For each repo path

Repeat for each repo:

4. **Resolve path** to absolute, verify it exists.

5. **Write workspace setting** — merge `codeViewer.enabled: true` into `.vscode/settings.json`:
   - If file exists: READ first, parse JSON, add/update `codeViewer.enabled`, write back
   - If not exists: `mkdir -p <repo>/.vscode && echo '{"codeViewer.enabled":true}'`
   - NEVER overwrite other settings

6. **Open VS Code**:
   ```bash
   code <repo-path>
   ```

7. **Toggle setting to force reconnection** (critical — VSIX install or cold start needs this):
   - Write `codeViewer.enabled: false` to settings.json
   - Wait 2 seconds
   - Write `codeViewer.enabled: true` to settings.json

### Phase 3: Verify

8. **Check backend log** for all workspaces connected (timeout 30s):
   ```bash
   cat /private/tmp/claude-501/codeview-backend.log
   ```
   Look for `Extension connected` + `registered workspace` for each repo name.

9. **Report result**:
   - List all connected workspaces
   - Frontend URL: `http://localhost:4801`
   - LAN IP for mobile: `ipconfig getifaddr en0` → `http://<IP>:4801`
   - Any workspaces that failed to connect

## Notes

- All commands that start background processes or write outside sandbox need `dangerouslyDisableSandbox: true`
- Multiple repos share the same backend/frontend — each gets its own workspace in the UI
- `code` CLI must be in PATH
- Safari iCloud Private Relay must be off for WebSocket
- VSIX must use `--no-dependencies` (pnpm monorepo incompatibility)
- If VS Code was already open before VSIX install, it needs restart to load new extension code
