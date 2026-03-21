/**
 * Launch VS Code with the extension loaded via @vscode/test-electron.
 * The extension auto-connects to backend on startup (activationEvents: onStartupFinished).
 *
 * Usage: node tests/e2e/launch-extension.mjs
 * Prereq: backend must be running on :4800
 */
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
// Resolve from extension package where it's installed
const { runTests } = require('../../extension/node_modules/@vscode/test-electron/out/index.js')
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '../..')
const extensionDevelopmentPath = resolve(projectRoot, 'extension')

// A minimal test file that just waits — we only need VS Code to launch and activate the extension
const extensionTestsPath = resolve(__dirname, 'extension-smoke.cjs')

try {
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    // Open the project root as workspace so the extension has files to browse
    launchArgs: [
      projectRoot,
      '--disable-extensions',  // disable other extensions for speed
    ],
  })
  console.log('[E2E] VS Code exited cleanly')
} catch (err) {
  console.error('[E2E] Failed to launch VS Code:', err)
  process.exit(1)
}
