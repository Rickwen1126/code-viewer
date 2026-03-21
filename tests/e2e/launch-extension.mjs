/**
 * Launch VS Code with the extension loaded via @vscode/test-electron.
 * The extension auto-connects to backend on startup (activationEvents: onStartupFinished).
 *
 * Usage:
 *   node tests/e2e/launch-extension.mjs                  # lightweight mode (fast, no user extensions)
 *   node tests/e2e/launch-extension.mjs --real            # real mode (user's VS Code + extensions, TS/LSP works)
 *   node tests/e2e/launch-extension.mjs --real --copilot  # full mode (+ user-data-dir for Copilot auth)
 *                                                         #   ⚠️ requires your VS Code to be CLOSED
 *
 * Prereq: backend must be running on :4800
 */
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { runTests } = require('../../extension/node_modules/@vscode/test-electron/out/index.js')
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(__dirname, '../..')
const extensionDevelopmentPath = resolve(projectRoot, 'extension')
const extensionTestsPath = resolve(__dirname, 'extension-smoke.cjs')

const args = process.argv.slice(2)
const useReal = args.includes('--real') || args.includes('--copilot')
const useCopilot = args.includes('--copilot')

// Workspace to open — default to project root, or pass custom path as last arg
const lastArg = args.filter(a => !a.startsWith('--')).pop()
const workspacePath = lastArg ? resolve(lastArg) : projectRoot

const vscodePath = '/Applications/Visual Studio Code.app/Contents/MacOS/Electron'
const userExtensionsDir = resolve(process.env.HOME, '.vscode/extensions')
const userDataDir = resolve(process.env.HOME, 'Library/Application Support/Code')

// Build launch args
const launchArgs = [workspacePath]

if (useReal) {
  if (!existsSync(vscodePath)) {
    console.error(`[E2E] VS Code not found at ${vscodePath}`)
    process.exit(1)
  }
  // Use user's extensions (TypeScript, Copilot, ESLint, etc.)
  launchArgs.push(`--extensions-dir=${userExtensionsDir}`)
  console.log('[E2E] Mode: REAL — using installed VS Code + user extensions')

  if (useCopilot) {
    // Use user's data dir for Copilot auth — VS Code must be closed!
    launchArgs.push(`--user-data-dir=${userDataDir}`)
    console.log('[E2E] Mode: FULL — Copilot auth enabled (your VS Code must be CLOSED)')
  }
} else {
  launchArgs.push('--disable-extensions')
  console.log('[E2E] Mode: LIGHTWEIGHT — clean VS Code, no user extensions')
}

console.log(`[E2E] Workspace: ${workspacePath}`)

const testConfig = {
  extensionDevelopmentPath,
  extensionTestsPath,
  launchArgs,
}

// In real/copilot mode, use installed VS Code binary
if (useReal) {
  testConfig.vscodeExecutablePath = vscodePath
}

try {
  await runTests(testConfig)
  console.log('[E2E] VS Code exited cleanly')
} catch (err) {
  console.error('[E2E] Failed to launch VS Code:', err)
  process.exit(1)
}
