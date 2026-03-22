---
name: codeview-start
description: Deploy code-viewer to view any repo. Takes a repo path argument, checks VSIX installed, starts Docker services, opens VS Code, verifies full connection.
---

# /codeview-start — Deploy to View a Repo

Start code-viewer in deployment mode to browse any repo from mobile/browser.

## Arguments

- `<repo-path>` (optional) — path to the repo to view. If omitted, ask the user.

## Steps

1. **Resolve repo path**:
   - If argument provided, use it (resolve to absolute path)
   - If not provided, ask user: "Which repo do you want to view?"
   - Verify path exists and is a directory

2. **Check VSIX installed**:
   ```bash
   code --list-extensions 2>/dev/null | grep -qi "code-viewer"
   ```
   If NOT installed:
   ```bash
   cd /Users/rickwen/code/code-viewer/extension && pnpm build && npx vsce package --no-dependencies
   code --install-extension code-viewer-extension-0.0.1.vsix
   ```
   Then verify again. If still fails, report error.

3. **Check ports** — if 4800/4801 already in use, check if it's our docker container:
   ```bash
   docker compose -f /Users/rickwen/code/code-viewer/docker-compose.yml ps
   ```
   - If already running: skip to step 5
   - If ports used by something else: report conflict, ask user

4. **Start Docker services**:
   ```bash
   cd /Users/rickwen/code/code-viewer && docker compose up -d
   ```
   Wait for services to be healthy (poll ports, timeout 30s).

5. **Write workspace setting** for the target repo:
   ```bash
   mkdir -p <repo-path>/.vscode
   # Write or merge codeViewer.enabled: true into settings.json
   ```
   IMPORTANT: If `.vscode/settings.json` already exists, READ it first and merge — don't overwrite other settings.

6. **Open VS Code** with the target repo:
   ```bash
   code <repo-path>
   ```

7. **Trigger extension connect** — toggle the setting to force reconnection:
   - Write `codeViewer.enabled: false` to settings.json
   - Wait 2 seconds
   - Write `codeViewer.enabled: true` to settings.json

8. **Verify connection** — poll backend for the workspace name appearing in logs (timeout 30s):
   ```bash
   docker compose -f /Users/rickwen/code/code-viewer/docker-compose.yml logs --tail=20
   ```
   Look for the workspace name (last segment of repo path) in connection messages.

9. **Report result**:
   - Success: "Code Viewer ready for `<repo-name>`. Open http://localhost:4801 (or http://<LAN-IP>:4801 on mobile)"
   - Include LAN IP: `ipconfig getifaddr en0`
   - Failure: diagnose from logs and report

## Notes

- Docker compose file is at `/Users/rickwen/code/code-viewer/docker-compose.yml`
- Multiple repos can be opened simultaneously — each gets its own workspace in the frontend
- The `code` CLI must be in PATH (VS Code > Cmd+Shift+P > "Shell Command: Install 'code' command in PATH")
- Safari iCloud Private Relay must be off for WebSocket to work
- Extension VSIX must be built with `--no-dependencies` (pnpm monorepo + vsce incompatibility)
