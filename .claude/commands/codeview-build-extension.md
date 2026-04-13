---
description: Build, package, install, and validate the Code Viewer VSIX for daily VS Code windows.
---

## User Input

```text
$ARGUMENTS
```

You should consider the user input before proceeding.

## Goal

Rebuild the installed Code Viewer extension and verify that daily VS Code windows are actually running the packaged version, not just showing it as installed.

## Workflow

1. Work from repo root: `/Users/rickwen/code/code-viewer`

2. Build and package the VSIX:
   ```bash
   pnpm --dir extension typecheck
   pnpm --dir extension package
   ```

3. Validate the VSIX contents before install:
   ```bash
   unzip -l extension/code-viewer-extension-0.0.5.vsix
   ```
   Accept only the bundled layout:
   - `extension/package.json`
   - `extension/dist/extension.js`
   - optional manifest/map files

   Reject the package if it contains:
   - `extension/dist/ws/client.js`
   - `extension/dist/providers/*.js`
   - `extension/node_modules/**`

4. Install the VSIX:
   ```bash
   code --install-extension /Users/rickwen/code/code-viewer/extension/code-viewer-extension-0.0.5.vsix --force
   ```

5. If the user wants daily VS Code windows updated, reload or restart those windows.

6. Verify runtime activation, not just installation:

   Installation check:
   ```bash
   code --list-extensions --show-versions | rg 'code-viewer-extension'
   ```

   Backend authority check:
   ```bash
   curl -s http://127.0.0.1:4800/admin/workspaces | jq '.'
   ```

   If backend stays empty, inspect newest exthost logs under:
   ```text
   ~/Library/Application Support/Code/logs/<timestamp>/window*/exthost/exthost.log
   ```

   Known bad signature:
   - `Activating extension undefined_publisher.code-viewer-extension failed`
   - `Cannot find module 'ws'`

## Invariants

- Do not trust `code --list-extensions` alone.
- Do not trust an existing `.vsix` file without rebuilding.
- The installed VSIX must ship the bundled `dist/extension.js` only.
- If source changed and the installed extension matters, rebuild before packaging.

## Reference

For the canonical packaging pitfall and rationale, read:

- `/Users/rickwen/code/code-viewer/docs/reference/extension-vsix-packaging.md`
