---
name: codeview-build-extension
description: "Build, package, install, and validate the repo-local Code Viewer VSIX for daily VS Code windows. Use when the user asks to rebuild the installed extension, refresh the VSIX, fix packaging/runtime activation problems, or verify backend sees the reloaded workspaces."
---

# /codeview-build-extension

Build and install the Code Viewer VSIX that daily VS Code windows use.

## Use when

- the user asks to rebuild or reinstall the installed extension
- VSIX packaging or activation is suspected
- backend does not see workspaces after VSIX install
- you need to verify daily VS Code is running the latest packaged extension

## Workflow

1. Build and package from repo root:
   ```bash
   pnpm --dir extension typecheck
   pnpm --dir extension package
   ```

2. Validate the VSIX contents before installing:
   ```bash
   unzip -l extension/code-viewer-extension-0.0.4.vsix
   ```
   Accept only the bundled entry layout:
   - `extension/package.json`
   - `extension/dist/extension.js`
   - optional manifest/map files

   Reject the package if it contains:
   - `extension/dist/ws/client.js`
   - `extension/dist/providers/*.js`
   - `extension/node_modules/**`

3. Install the VSIX:
   ```bash
   code --install-extension /Users/rickwen/code/code-viewer/extension/code-viewer-extension-0.0.4.vsix --force
   ```

4. If the user needs daily VS Code windows to pick up the new build, reload or restart those windows.

5. Verify runtime activation, not just installation.

## Runtime validation

### Installation check

```bash
code --list-extensions --show-versions | rg 'code-viewer-extension'
```

This only proves install state. It does **not** prove activation.

### Backend authority check

If backend on `4800` is already running, prefer:

```bash
curl -s http://127.0.0.1:4800/admin/workspaces | jq '.'
```

Expected:

- the target workspaces appear
- `extensionVersion` matches the package version
- `status` is `connected`

### Exthost failure check

If backend stays empty, inspect the newest:

```bash
~/Library/Application Support/Code/logs/<timestamp>/window*/exthost/exthost.log
```

Known bad signature:

- `Activating extension undefined_publisher.code-viewer-extension failed`
- `Cannot find module 'ws'`

That means the VSIX shipped unbundled runtime files and VS Code loaded the wrong entry path.

## Invariants

- The installed VSIX must ship the bundled `dist/extension.js` only.
- Do not trust an old `.vsix` file without rebuilding.
- Do not conclude success from `code --list-extensions` alone.
- When source changed and the installed extension matters, rebuild before packaging.

## Reference

For the canonical packaging pitfall and rationale, read:

- `docs/reference/extension-vsix-packaging.md`
