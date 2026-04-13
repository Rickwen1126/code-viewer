# Extension VSIX Packaging

This note records the canonical build/package/install flow for the Code Viewer extension and the packaging bug that caused runtime activation failure on 2026-04-12.

## Failure mode

Symptom:

- VSIX installs successfully
- VS Code activates `undefined_publisher.code-viewer-extension`
- activation immediately fails with `Error: Cannot find module 'ws'`
- backend `/admin/workspaces` stays empty because the extension never reaches `workspace.register`

Observed stack:

- `dist/ws/client.js`
- `dist/extension.js`

Root cause:

- the installed VSIX contained unbundled `dist/**/*.js` artifacts from `tsc`
- VS Code loaded an older CommonJS `dist/extension.js` that still required `./ws/client`
- `dist/ws/client.js` then required runtime module `ws`
- the VSIX did not ship `node_modules/ws`, so activation crashed

## Canonical invariant

The installed VSIX must ship the bundled entry only:

- `extension/dist/extension.js`
- optionally `extension/dist/extension.js.map`

It must **not** ship:

- `extension/dist/ws/client.js`
- `extension/dist/providers/*.js`
- `extension/node_modules/**`

If those files appear in the VSIX, the package is suspect and should not be trusted.

## Canonical commands

From repo root:

```bash
pnpm --dir extension typecheck
pnpm --dir extension package
code --install-extension /Users/rickwen/code/code-viewer/extension/code-viewer-extension-0.0.4.vsix --force
```

The `extension/package.json` scripts are the source of truth:

- `build`: `rm -rf dist && tsc --emitDeclarationOnly && esbuild ... --bundle ...`
- `package`: `pnpm run build && vsce package --no-dependencies`

## Required validation

After `pnpm --dir extension package`, inspect the VSIX contents:

```bash
unzip -l extension/code-viewer-extension-0.0.4.vsix
```

Expected shape:

```text
extension/
  package.json
  dist/
    extension.js
```

Reject the package if you see:

- `extension/dist/ws/client.js`
- `extension/dist/providers/...`
- `extension/node_modules/...`

## Installed-runtime validation

If the user wants the installed extension to take effect in daily VS Code windows:

1. install the VSIX with `--force`
2. reload or restart every relevant VS Code window
3. verify runtime, not just installation

Verification options:

### 1. Backend authority

If backend is running on `4800`, check:

```bash
curl -s http://127.0.0.1:4800/admin/workspaces | jq '.'
```

Expected:

- each workspace appears in `workspaces`
- `extensionVersion` matches the packaged version
- `status` is `connected`

If backend stays empty, the extension is not actually active even if VSIX installation succeeded.

### 2. VS Code exthost logs

Check the latest `exthost.log` under:

```text
~/Library/Application Support/Code/logs/<timestamp>/window*/exthost/exthost.log
```

Look for:

- `Activating extension undefined_publisher.code-viewer-extension failed`
- `Cannot find module 'ws'`

Those lines mean the installed package is broken at runtime.

## Guardrails

- Do not trust `code --list-extensions --show-versions` alone. It proves installation, not activation.
- Do not trust a stale `code-viewer-extension-0.0.4.vsix` file. Re-run `pnpm --dir extension package`.
- Do not package raw `dist/` output from `tsc` without cleaning it first.
- If source changed and you need an installed VSIX, always rebuild before packaging.

## When to use this note

Use this reference whenever any of the following happens:

- rebuilding the installed extension
- debugging “extension installed but backend sees no workspace”
- debugging extension activation failures in daily VS Code
- touching `extension/package.json` build/package scripts
