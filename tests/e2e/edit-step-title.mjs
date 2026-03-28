import { chromium, devices } from '@playwright/test'
import { appendFileSync, writeFileSync } from 'fs'

const BASE_URL = 'http://127.0.0.1:4801'
const TOUR_TITLE = 'E2E Preserve Title'
const WORKSPACE_PATH = '/Users/rickwen/code/code-viewer'
const UPDATED_TEXT = `Updated content from Playwright E2E ${Date.now()}`
const SCREENSHOT_AFTER_SAVE = '/tmp/code-viewer-e2e-edit-title-after-save.png'
const SCREENSHOT_ROUNDTRIP = '/tmp/code-viewer-e2e-edit-title-roundtrip.png'
const CONSOLE_LOG = '/tmp/code-viewer-e2e-edit-title-console.log'

writeFileSync(CONSOLE_LOG, '')
const consoleLines = []

function logLine(line) {
  consoleLines.push(line)
  appendFileSync(CONSOLE_LOG, `${line}\n`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function main() {
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  })

  const context = await browser.newContext({
    ...devices['iPhone 12'],
  })

  const page = await context.newPage()
  const pageErrors = []

  page.on('console', (msg) => {
    const text = msg.text()
    logLine(`[console:${msg.type()}] ${text}`)
  })

  page.on('pageerror', (err) => {
    const msg = `[pageerror] ${err.message}`
    pageErrors.push(msg)
    logLine(msg)
  })

  await page.addInitScript(() => {
    localStorage.setItem('code-viewer:debug', 'true')
  })

  try {
    await page.goto(`${BASE_URL}/workspaces`, { waitUntil: 'networkidle' })

    const workspaceButton = page.locator('button', { hasText: WORKSPACE_PATH }).first()
    await workspaceButton.waitFor({ state: 'visible', timeout: 15000 })
    await workspaceButton.click()
    await page.waitForURL(/\/files/, { timeout: 15000 })

    await page.getByRole('button', { name: 'Tours' }).click()
    await page.waitForURL(/\/tours$/, { timeout: 15000 })

    const tourButton = page.locator('button', { hasText: TOUR_TITLE }).first()
    await tourButton.waitFor({ state: 'visible', timeout: 15000 })
    await tourButton.click()
    await page.waitForURL(/\/tours\//, { timeout: 15000 })

    const titleBeforeSave = page.getByText('Preserve Me', { exact: true }).first()
    await titleBeforeSave.waitFor({ state: 'visible', timeout: 15000 })

    await page.getByRole('button', { name: 'Edit' }).click()
    await page.getByText('Edit Step Description', { exact: true }).waitFor({ state: 'visible', timeout: 15000 })

    const titleInput = page.getByPlaceholder('Title (## heading)').first()
    const contentInput = page.getByPlaceholder('Content...').first()
    await titleInput.waitFor({ state: 'visible', timeout: 15000 })
    await contentInput.waitFor({ state: 'visible', timeout: 15000 })

    assert(await titleInput.inputValue() === 'Preserve Me', 'Edit overlay did not preserve the existing step title')
    await titleInput.fill('Preserve Me')
    await contentInput.fill(UPDATED_TEXT)

    await page.getByRole('button', { name: 'Save' }).click()
    await page.getByText('Edit Step Description', { exact: true }).waitFor({ state: 'hidden', timeout: 15000 })

    const titleAfterSave = page.getByText('Preserve Me', { exact: true }).first()
    const updatedTextAfterSave = page.getByText(UPDATED_TEXT, { exact: true }).first()
    await titleAfterSave.waitFor({ state: 'visible', timeout: 15000 })
    await updatedTextAfterSave.waitFor({ state: 'visible', timeout: 15000 })
    await page.screenshot({ path: SCREENSHOT_AFTER_SAVE, fullPage: true })

    await page.getByRole('button', { name: '← Tours' }).click()
    await page.waitForURL(/\/tours$/, { timeout: 15000 })
    await tourButton.waitFor({ state: 'visible', timeout: 15000 })
    await tourButton.click()
    await page.waitForURL(/\/tours\//, { timeout: 15000 })

    const titleAfterRoundTrip = page.getByText('Preserve Me', { exact: true }).first()
    const updatedTextAfterRoundTrip = page.getByText(UPDATED_TEXT, { exact: true }).first()
    await titleAfterRoundTrip.waitFor({ state: 'visible', timeout: 15000 })
    await updatedTextAfterRoundTrip.waitFor({ state: 'visible', timeout: 15000 })
    await page.screenshot({ path: SCREENSHOT_ROUNDTRIP, fullPage: true })

    const hasDeleteResult = consoleLines.some(line => line.includes('[ws] ⇐ tour.deleteStep.result'))
    const hasAddResult = consoleLines.some(line => line.includes('[ws] ⇐ tour.addStep.result'))
    const hasWsError = consoleLines.some(
      line => line.includes('[ws] ⇐ ERROR') || line.includes('[ws] ⇐ tour.deleteStep.error') || line.includes('[ws] ⇐ tour.addStep.error'),
    )

    const result = {
      uiBeforeSave: true,
      uiAfterSave: true,
      roundTrip: true,
      pageErrors: pageErrors,
      hasDeleteResult,
      hasAddResult,
      hasWsError,
      notes: pageErrors.join('\n'),
    }

    assert(hasDeleteResult, 'Missing tour.deleteStep.result in frontend console log')
    assert(hasAddResult, 'Missing tour.addStep.result in frontend console log')
    assert(!hasWsError, 'Unexpected WS error log found in frontend console log')

    await browser.close()
    console.log(JSON.stringify(result, null, 2))
  } catch (err) {
    await browser.close()
    console.error(err)
    process.exit(1)
  }
}

main()
