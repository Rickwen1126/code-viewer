import { chromium, devices } from '@playwright/test'
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

const BASE_URL = 'http://127.0.0.1:4801'
const BACKEND_URL = 'http://127.0.0.1:4800'
const WORKSPACE_PATH = process.argv[2]

if (!WORKSPACE_PATH) {
  console.error('Usage: node tests/e2e/git-media-preview.mjs <workspace-path>')
  process.exit(1)
}

const OUTPUT_DIR = '/private/tmp/claude-501'
const RUN_ID = `${Date.now()}`
const CONSOLE_LOG = `${OUTPUT_DIR}/codeview-e2e-git-media-preview-console-${RUN_ID}.log`
const RESULT_JSON = `${OUTPUT_DIR}/codeview-e2e-git-media-preview-result-${RUN_ID}.json`
const SCREENSHOT_DIFF = `${OUTPUT_DIR}/codeview-e2e-git-media-preview-diff-${RUN_ID}.png`
const SCREENSHOT_FILE = `${OUTPUT_DIR}/codeview-e2e-git-media-preview-file-${RUN_ID}.png`
const TEMP_RELATIVE_PATH = `git-media-preview-${RUN_ID}.png`
const TEMP_ABSOLUTE_PATH = join(WORKSPACE_PATH, TEMP_RELATIVE_PATH)
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WfRzy8AAAAASUVORK5CYII='

writeFileSync(CONSOLE_LOG, '')
const consoleLines = []
const pageErrors = []

function logLine(line) {
  consoleLines.push(line)
  appendFileSync(CONSOLE_LOG, `${line}\n`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function resolveWorkspaceKey(rootPath) {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    const response = await fetch(`${BACKEND_URL}/admin/workspaces`)
    if (!response.ok) {
      throw new Error(`Failed to load admin workspaces: ${response.status} ${response.statusText}`)
    }
    const payload = await response.json()
    const workspace = payload.workspaces?.find((entry) => entry.rootPath === rootPath && entry.status === 'connected')
    if (workspace?.workspaceKey) {
      return workspace.workspaceKey
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`Timed out waiting for workspaceKey for ${rootPath}`)
}

function cleanupTempFile() {
  rmSync(TEMP_ABSOLUTE_PATH, { force: true })
}

async function main() {
  mkdirSync(dirname(TEMP_ABSOLUTE_PATH), { recursive: true })
  writeFileSync(TEMP_ABSOLUTE_PATH, Buffer.from(PNG_BASE64, 'base64'))

  const workspaceKey = await resolveWorkspaceKey(WORKSPACE_PATH)
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  })

  const context = await browser.newContext({
    ...devices['iPhone 12'],
  })
  const page = await context.newPage()

  page.on('console', (msg) => {
    logLine(`[console:${msg.type()}] ${msg.text()}`)
  })

  page.on('pageerror', (error) => {
    const line = `[pageerror] ${error.message}`
    pageErrors.push(line)
    logLine(line)
  })

  await page.addInitScript(() => {
    localStorage.setItem('code-viewer:debug', 'true')
  })

  const result = {
    runId: RUN_ID,
    workspaceKey,
    tempRelativePath: TEMP_RELATIVE_PATH,
    gitDiff: {
      url: null,
      imageRendered: false,
      infoBanner: false,
    },
    filePreview: {
      url: null,
      imageRendered: false,
      backToDiffVisible: false,
    },
    consoleLog: CONSOLE_LOG,
    pageErrors: [],
  }

  try {
    const diffUrl =
      `${BASE_URL}/open/git-diff?workspace=${encodeURIComponent(workspaceKey)}` +
      `&path=${encodeURIComponent(TEMP_RELATIVE_PATH)}&status=added`
    await page.goto(diffUrl, { waitUntil: 'networkidle' })
    await page.waitForURL(new RegExp(`/git/diff/${TEMP_RELATIVE_PATH.replace('.', '\\.')}\\?status=added$`), {
      timeout: 20000,
    })
    await page.locator(`img[alt="${TEMP_RELATIVE_PATH}"]`).waitFor({ state: 'visible', timeout: 15000 })
    result.gitDiff.url = page.url()
    result.gitDiff.imageRendered = await page
      .locator(`img[alt="${TEMP_RELATIVE_PATH}"]`)
      .evaluate((element) => element.clientWidth > 0 && element.clientHeight > 0)
    result.gitDiff.infoBanner = await page.getByText('Binary/media diff is unavailable. Showing the current workspace preview instead.').isVisible()
    await page.screenshot({ path: SCREENSHOT_DIFF, fullPage: true })
    assert(result.gitDiff.imageRendered, 'Git diff media preview image did not render')
    assert(result.gitDiff.infoBanner, 'Git diff media preview banner was not visible')

    await page.getByRole('button', { name: 'View in Code' }).click()
    await page.waitForURL(new RegExp(`/files/${TEMP_RELATIVE_PATH.replace('.', '\\.')}$`), { timeout: 15000 })
    await page.getByRole('button', { name: 'Back to Diff' }).waitFor({ state: 'visible', timeout: 15000 })
    await page.locator(`img[alt="${TEMP_RELATIVE_PATH}"]`).waitFor({ state: 'visible', timeout: 15000 })
    result.filePreview.url = page.url()
    result.filePreview.backToDiffVisible = await page.getByRole('button', { name: 'Back to Diff' }).isVisible()
    result.filePreview.imageRendered = await page
      .locator(`img[alt="${TEMP_RELATIVE_PATH}"]`)
      .evaluate((element) => element.clientWidth > 0 && element.clientHeight > 0)
    await page.screenshot({ path: SCREENSHOT_FILE, fullPage: true })
    assert(result.filePreview.imageRendered, 'File viewer preview did not render after opening from git diff')
    assert(result.filePreview.backToDiffVisible, 'Back to Diff was not visible in the file viewer preview')

    const previewErrors = consoleLines.filter((line) => line.includes('file.preview.error') || line.includes('[ws] ⇐ ERROR'))
    assert(previewErrors.length === 0, `Unexpected preview errors:\n${previewErrors.join('\n')}`)
    assert(pageErrors.length === 0, `Unexpected page errors:\n${pageErrors.join('\n')}`)

    result.pageErrors = pageErrors
    writeFileSync(RESULT_JSON, JSON.stringify(result, null, 2))
    await browser.close()
    cleanupTempFile()
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    result.pageErrors = [...pageErrors, String(error)]
    writeFileSync(RESULT_JSON, JSON.stringify(result, null, 2))
    await browser.close()
    cleanupTempFile()
    console.error(error)
    process.exit(1)
  }
}

main()
