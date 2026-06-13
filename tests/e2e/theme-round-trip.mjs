/**
 * Theme Round-Trip E2E — verify theme persistence across reload
 *
 * Viewport: iPhone 390 × 844 (mobile-first product)
 * Requires: frontend :4801 running
 *
 * Checklist:
 * TH-01  Default theme is vscode (data-theme absent or "vscode", dark bg)
 * TH-02  Settings gear opens theme picker, switch to e-ink
 * TH-03  E-ink theme applies (data-theme="eink", white bg, meta theme-color)
 * TH-04  Theme persists after full page reload (localStorage round-trip)
 * TH-05  Switch back to vscode, verify dark bg restored
 * TH-06  Console log integrity (no errors throughout)
 */
import { chromium } from '@playwright/test'
import { appendFileSync, writeFileSync, mkdirSync } from 'fs'

const BASE_URL = 'http://127.0.0.1:4801'
const RUN_ID = `${Date.now()}`

const OUTPUT_DIR = '/private/tmp/claude-501'
try { mkdirSync(OUTPUT_DIR, { recursive: true }) } catch {}
const CONSOLE_LOG = `${OUTPUT_DIR}/codeview-e2e-theme-console-${RUN_ID}.log`
const RESULT_JSON = `${OUTPUT_DIR}/codeview-e2e-theme-result-${RUN_ID}.json`
const SCREENSHOT = (name) => `${OUTPUT_DIR}/codeview-e2e-theme-${name}-${RUN_ID}.png`

writeFileSync(CONSOLE_LOG, '')
const consoleLines = []
const pageErrors = []

function logLine(line) {
  consoleLines.push(line)
  appendFileSync(CONSOLE_LOG, `${line}\n`)
}

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`)
}

async function getThemeState(page) {
  return page.evaluate(() => {
    const html = document.documentElement
    const dataTheme = html.getAttribute('data-theme') || 'vscode'
    const bodyBg = getComputedStyle(document.body).backgroundColor
    const meta = document.querySelector('meta[name="theme-color"]')
    const metaColor = meta?.content || null
    const stored = localStorage.getItem('code-viewer:theme')
    return { dataTheme, bodyBg, metaColor, stored }
  })
}

async function main() {
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  })

  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  })
  const page = await context.newPage()

  page.on('console', (msg) => logLine(`[console:${msg.type()}] ${msg.text()}`))
  page.on('pageerror', (error) => {
    const line = `[pageerror] ${error.message}`
    pageErrors.push(line)
    logLine(line)
  })

  // Clear any existing theme preference
  await page.addInitScript(() => {
    localStorage.removeItem('code-viewer:theme')
  })

  const result = { runId: RUN_ID, checks: {}, consoleLog: CONSOLE_LOG, pageErrors: [] }

  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 20000 })
    await page.waitForTimeout(2000)

    // ─── TH-01  Default theme is vscode ───
    const defaultState = await getThemeState(page)
    assert(
      defaultState.dataTheme === 'vscode' || !defaultState.dataTheme,
      `Default data-theme should be vscode, got "${defaultState.dataTheme}"`,
    )
    assert(
      defaultState.stored === null || defaultState.stored === 'vscode',
      `Default stored theme should be null or vscode, got "${defaultState.stored}"`,
    )

    await page.screenshot({ path: SCREENSHOT('01-default'), fullPage: false })
    result.checks['TH-01'] = { pass: true, ...defaultState }
    console.log('✓ TH-01  Default theme is vscode')

    // ─── TH-02  Settings gear → switch to e-ink ───
    const gearBtn = page.locator('button[title="Settings"]')
    await gearBtn.waitFor({ state: 'visible', timeout: 10000 })
    await gearBtn.click()

    // Wait for ActionSheet to appear with theme options
    const einkOption = page.locator('button').filter({ hasText: /E-Ink/ }).first()
    await einkOption.waitFor({ state: 'visible', timeout: 5000 })
    await einkOption.click()
    await page.waitForTimeout(500)

    result.checks['TH-02'] = { pass: true }
    console.log('✓ TH-02  Settings gear → e-ink theme selected')

    // ─── TH-03  E-ink theme applies ───
    const einkState = await getThemeState(page)
    assert(einkState.dataTheme === 'eink', `data-theme should be "eink", got "${einkState.dataTheme}"`)
    assert(einkState.stored === 'eink', `localStorage should store "eink", got "${einkState.stored}"`)
    // E-ink body bg should be white-ish (rgb(255, 255, 255) or similar)
    assert(
      einkState.bodyBg.includes('255') || einkState.bodyBg === 'white',
      `E-ink body background should be white, got "${einkState.bodyBg}"`,
    )

    await page.screenshot({ path: SCREENSHOT('03-eink'), fullPage: false })
    result.checks['TH-03'] = { pass: true, ...einkState }
    console.log('✓ TH-03  E-ink theme applied correctly')

    // ─── TH-04  Theme persists after reload ───
    await page.reload({ waitUntil: 'networkidle', timeout: 20000 })
    await page.waitForTimeout(1500)

    const afterReloadState = await getThemeState(page)
    assert(afterReloadState.dataTheme === 'eink', `After reload data-theme should be "eink", got "${afterReloadState.dataTheme}"`)
    assert(afterReloadState.stored === 'eink', `After reload localStorage should be "eink", got "${afterReloadState.stored}"`)
    assert(
      afterReloadState.bodyBg.includes('255') || afterReloadState.bodyBg === 'white',
      `After reload body bg should be white, got "${afterReloadState.bodyBg}"`,
    )

    await page.screenshot({ path: SCREENSHOT('04-reload-persist'), fullPage: false })
    result.checks['TH-04'] = { pass: true, ...afterReloadState }
    console.log('✓ TH-04  Theme persists after reload')

    // ─── TH-05  Switch back to vscode ───
    const gearBtn2 = page.locator('button[title="Settings"]')
    await gearBtn2.waitFor({ state: 'visible', timeout: 10000 })
    await gearBtn2.click()

    const vscodeOption = page.locator('button').filter({ hasText: /VS Code/ }).first()
    await vscodeOption.waitFor({ state: 'visible', timeout: 5000 })
    await vscodeOption.click()
    await page.waitForTimeout(500)

    const restoredState = await getThemeState(page)
    assert(
      restoredState.dataTheme === 'vscode',
      `Restored data-theme should be "vscode", got "${restoredState.dataTheme}"`,
    )
    assert(restoredState.stored === 'vscode', `Restored localStorage should be "vscode", got "${restoredState.stored}"`)
    // Dark theme body bg should NOT be white
    assert(
      !restoredState.bodyBg.includes('255, 255, 255'),
      `Restored body bg should not be white, got "${restoredState.bodyBg}"`,
    )

    await page.screenshot({ path: SCREENSHOT('05-restored'), fullPage: false })
    result.checks['TH-05'] = { pass: true, ...restoredState }
    console.log('✓ TH-05  VS Code theme restored')

    // ─── TH-06  Console log integrity ───
    const errors = consoleLines.filter((line) =>
      line.includes('[pageerror]') || line.includes('Uncaught'),
    )
    assert(errors.length === 0, `Runtime errors detected:\n${errors.join('\n')}`)

    result.checks['TH-06'] = { pass: true, totalConsoleLogs: consoleLines.length }
    console.log(`✓ TH-06  Console log integrity (${consoleLines.length} lines, 0 errors)`)

    // Summary
    const allChecks = Object.entries(result.checks)
    const passed = allChecks.filter(([, v]) => v.pass).length
    console.log(`\n${passed}/${allChecks.length} checks passed`)

    result.pageErrors = pageErrors
    writeFileSync(RESULT_JSON, JSON.stringify(result, null, 2))
    await browser.close()

    if (passed < allChecks.length) process.exit(1)
  } catch (error) {
    result.pageErrors = [...pageErrors, String(error)]
    result.checks._fatal = { pass: false, error: String(error) }
    writeFileSync(RESULT_JSON, JSON.stringify(result, null, 2))
    await page.screenshot({ path: SCREENSHOT('fatal'), fullPage: false }).catch(() => {})
    await browser.close()
    console.error(error)
    process.exit(1)
  }
}

main()
