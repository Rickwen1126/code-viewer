/**
 * Minimal extension test — waits for activation then keeps VS Code alive
 * for E2E browser tests to run against the frontend.
 *
 * @vscode/test-electron calls run() and the process exits when it returns.
 * We keep it alive for 5 minutes (enough time for Playwright E2E).
 */
const { setTimeout } = require('timers/promises')

async function run() {
  console.log('[E2E] Extension host started, waiting for activation...')

  // Give extension time to activate and connect to backend
  await setTimeout(3000)

  console.log('[E2E] Extension should be connected. Keeping VS Code alive for E2E tests...')
  console.log('[E2E] Will auto-exit in 5 minutes.')

  // Keep alive for E2E — Playwright tests run in parallel
  await setTimeout(5 * 60 * 1000)
}

module.exports = { run }
