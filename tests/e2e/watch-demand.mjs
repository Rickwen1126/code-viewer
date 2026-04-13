import { chromium, devices } from '@playwright/test'
import { appendFileSync, existsSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

const BASE_URL = 'http://127.0.0.1:4801'
const WORKSPACE_PATH = '/Users/rickwen/code/code-viewer'
const RUN_ID = `${Date.now()}`
const TEST_FILE = `e2e-watch-demand-${RUN_ID}.txt`
const TEST_FILE_2 = `e2e-watch-demand-git-${RUN_ID}.txt`
const TEST_FILE_PATH = join(WORKSPACE_PATH, TEST_FILE)
const TEST_FILE_2_PATH = join(WORKSPACE_PATH, TEST_FILE_2)
const INITIAL_CONTENT = `watch-demand initial ${RUN_ID}`
const UPDATED_CONTENT = `watch-demand updated ${RUN_ID}`
const GIT_CONTENT = `watch-demand git ${RUN_ID}`

const FRONTEND_LOG = `/private/tmp/claude-501/codeview-e2e-watch-console-${RUN_ID}.log`
const RESULT_JSON = `/private/tmp/claude-501/codeview-e2e-watch-result-${RUN_ID}.json`
const SCREENSHOT_FILES_STALE = `/private/tmp/claude-501/codeview-e2e-watch-files-stale-${RUN_ID}.png`
const SCREENSHOT_FILE_LIVE = `/private/tmp/claude-501/codeview-e2e-watch-file-live-${RUN_ID}.png`
const SCREENSHOT_GIT_LIVE = `/private/tmp/claude-501/codeview-e2e-watch-git-live-${RUN_ID}.png`

writeFileSync(FRONTEND_LOG, '')

const consoleLines = []
const pageErrors = []

function logLine(line) {
  consoleLines.push(line)
  appendFileSync(FRONTEND_LOG, `${line}\n`)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function cleanupFiles() {
  if (existsSync(TEST_FILE_PATH)) rmSync(TEST_FILE_PATH)
  if (existsSync(TEST_FILE_2_PATH)) rmSync(TEST_FILE_2_PATH)
}

async function waitForPathText(page, text, timeout = 15000) {
  await page.getByText(text, { exact: true }).first().waitFor({ state: 'visible', timeout })
}

async function main() {
  cleanupFiles()

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

  page.on('pageerror', (err) => {
    const line = `[pageerror] ${err.message}`
    pageErrors.push(line)
    logLine(line)
  })

  await page.addInitScript(() => {
    localStorage.setItem('code-viewer:debug', 'true')
  })

  const result = {
    runId: RUN_ID,
    workspaceExtensionId: null,
    filesPageDidAutoRefresh: false,
    fileLiveUpdated: false,
    gitLiveUpdated: false,
    pageErrors: [],
    frontendLog: FRONTEND_LOG,
    screenshots: {
      filesStale: SCREENSHOT_FILES_STALE,
      fileLive: SCREENSHOT_FILE_LIVE,
      gitLive: SCREENSHOT_GIT_LIVE,
    },
  }

  try {
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => {
      localStorage.removeItem('code-viewer:selected-workspace')
      localStorage.removeItem('code-viewer:current-file')
    })
    await page.goto(`${BASE_URL}/workspaces`, { waitUntil: 'networkidle' })

    const workspaceButton = page.locator('button').filter({ hasText: WORKSPACE_PATH }).last()
    await workspaceButton.waitFor({ state: 'visible', timeout: 15000 })
    await workspaceButton.click()
    await page.waitForURL(/\/files$/, { timeout: 15000 })

    const selectedWorkspaceRaw = await page.evaluate(() => localStorage.getItem('code-viewer:selected-workspace'))
    const selectedWorkspace = selectedWorkspaceRaw ? JSON.parse(selectedWorkspaceRaw) : null
    result.workspaceExtensionId = selectedWorkspace?.extensionId ?? null

    writeFileSync(TEST_FILE_PATH, `${INITIAL_CONTENT}\n`, 'utf8')
    await page.waitForTimeout(2000)

    const fileBeforeReloadVisible = await page.getByText(TEST_FILE, { exact: true }).first().isVisible().catch(() => false)
    result.filesPageDidAutoRefresh = fileBeforeReloadVisible
    assert(!fileBeforeReloadVisible, 'Files page auto-refreshed before explicit reload; file tree should stay stale without demand-watch')
    await page.screenshot({ path: SCREENSHOT_FILES_STALE, fullPage: true })

    await page.reload({ waitUntil: 'networkidle' })
    await waitForPathText(page, TEST_FILE)
    await page.getByText(TEST_FILE, { exact: true }).first().click()
    await waitForPathText(page, INITIAL_CONTENT)

    writeFileSync(TEST_FILE_PATH, `${UPDATED_CONTENT}\n`, 'utf8')
    await waitForPathText(page, UPDATED_CONTENT)
    result.fileLiveUpdated = true
    await page.screenshot({ path: SCREENSHOT_FILE_LIVE, fullPage: true })

    await page.getByRole('button', { name: 'Git' }).click()
    await page.waitForURL(/\/git$/, { timeout: 15000 })
    await page.getByText(/changed|No changes|Loading git status/i).first().waitFor({ state: 'visible', timeout: 15000 })

    writeFileSync(TEST_FILE_2_PATH, `${GIT_CONTENT}\n`, 'utf8')
    await waitForPathText(page, TEST_FILE_2, 20000)
    result.gitLiveUpdated = true
    await page.screenshot({ path: SCREENSHOT_GIT_LIVE, fullPage: true })

    const hasFileWatchSync = consoleLines.some(
      (line) => line.includes('[watch] sync') && line.includes(`/files/${TEST_FILE}`) && line.includes('watches: Array(1)'),
    )
    const hasGitWatchSync = consoleLines.some(
      (line) => line.includes('[watch] sync') && line.includes('pathname: /git') && line.includes('watches: Array(1)'),
    )
    const hasFileEvent = consoleLines.some((line) => line.includes('[watch:file] event'))
    const hasGitEvent = consoleLines.some((line) => line.includes('[watch:git] event'))
    const hasWsError = consoleLines.some((line) => line.includes('[ws] ⇐ ERROR') || line.includes('.error'))

    assert(hasFileWatchSync, 'Missing frontend watch sync log for file.content demand')
    assert(hasGitWatchSync, 'Missing frontend watch sync log for git.status demand')
    assert(hasFileEvent, 'Missing frontend file watch event log after file change')
    assert(hasGitEvent, 'Missing frontend git watch event log after git change')
    assert(!hasWsError, 'Unexpected frontend WS error log found')

    result.pageErrors = pageErrors
    writeFileSync(RESULT_JSON, JSON.stringify(result, null, 2))

    await browser.close()
    cleanupFiles()
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    result.pageErrors = [...pageErrors, String(error)]
    writeFileSync(RESULT_JSON, JSON.stringify(result, null, 2))
    await browser.close()
    cleanupFiles()
    console.error(error)
    process.exit(1)
  }
}

main()
