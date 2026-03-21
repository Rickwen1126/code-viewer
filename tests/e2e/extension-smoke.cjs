/**
 * Minimal extension test — waits for activation then keeps VS Code alive
 * indefinitely for E2E browser tests to run against the frontend.
 *
 * @vscode/test-electron calls run() and the process exits when it returns.
 * We block forever until the process is killed (Ctrl+C or task stop).
 */
const { setTimeout } = require('timers/promises')

async function run() {
  console.log('[E2E] Extension host started, waiting for activation...')

  // Give extension time to activate and connect to backend
  await setTimeout(3000)

  console.log('[E2E] Extension connected. VS Code will stay alive for 30 minutes.')

  // Keep alive for testing
  await setTimeout(30 * 60 * 1000)
}

module.exports = { run }
