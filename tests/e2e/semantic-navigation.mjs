import { chromium, devices } from '@playwright/test'
import { appendFileSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'

const BASE_URL = 'http://127.0.0.1:4801'
const WORKSPACE_PATH = '/Users/rickwen/code/code-viewer'
const TOUR_ID = '02-edit-step-boundary-code-viewer'
const TOUR_TITLE = '02 - Sky Eye: Code Viewer Edit Step Boundary'
const RUN_ID = `${Date.now()}`
const APP_FILE_PATH = join(WORKSPACE_PATH, 'frontend/src/app.tsx')
const APP_TARGET_TEXT = 'path="open/file"'
const GIT_TARGET_FILE = 'packages/cli/src/index.ts'

const OUTPUT_DIR = '/private/tmp/claude-501'
const CONSOLE_LOG = `${OUTPUT_DIR}/codeview-e2e-semantic-navigation-console-${RUN_ID}.log`
const RESULT_JSON = `${OUTPUT_DIR}/codeview-e2e-semantic-navigation-result-${RUN_ID}.json`
const SCREENSHOT_OPEN_FILE = `${OUTPUT_DIR}/codeview-e2e-semantic-navigation-open-file-${RUN_ID}.png`
const SCREENSHOT_TOUR_CODE = `${OUTPUT_DIR}/codeview-e2e-semantic-navigation-tour-code-${RUN_ID}.png`
const SCREENSHOT_GIT_CODE = `${OUTPUT_DIR}/codeview-e2e-semantic-navigation-git-code-${RUN_ID}.png`

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

function findOneBasedLine(filePath, needle) {
  const lines = readFileSync(filePath, 'utf8').split('\n')
  const index = lines.findIndex((line) => line.includes(needle))
  if (index === -1) {
    throw new Error(`Could not find "${needle}" in ${filePath}`)
  }
  return index + 1
}

async function expectNoRuntimeErrors() {
  const wsErrors = consoleLines.filter((line) => line.includes('[ws] ⇐ ERROR') || line.includes('.error'))
  assert(wsErrors.length === 0, `Unexpected WS errors:\n${wsErrors.join('\n')}`)
  assert(pageErrors.length === 0, `Unexpected page errors:\n${pageErrors.join('\n')}`)
}

async function main() {
  const targetLine = findOneBasedLine(APP_FILE_PATH, APP_TARGET_TEXT)
  const headCommit = execSync('git rev-parse HEAD', {
    cwd: WORKSPACE_PATH,
    encoding: 'utf8',
  }).trim()
  const headCommitShort = headCommit.slice(0, 7)
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
    localStorage.removeItem('code-viewer:selected-workspace')
    localStorage.removeItem('code-viewer:current-file')
  })

  const result = {
    runId: RUN_ID,
    targetLine,
    openFile: {
      resolvedUrl: null,
      workspaceRoot: null,
      listWorkspacesResult: false,
      selectWorkspaceResult: false,
      highlightRuleFound: false,
    },
    tourDetour: {
      stepUrl: null,
      codeUrl: null,
      unwindUrl: null,
      forwardUrl: null,
    },
    gitDetour: {
      commit: headCommit,
      diffUrl: null,
      codeUrl: null,
      unwindUrl: null,
      forwardUrl: null,
      gitDiffResult: false,
    },
    consoleLog: CONSOLE_LOG,
    pageErrors: [],
  }

  try {
    const openFileUrl = `${BASE_URL}/open/file?workspace=${encodeURIComponent(WORKSPACE_PATH)}&path=${encodeURIComponent('frontend/src/app.tsx')}&line=${targetLine}`
    await page.goto(openFileUrl, { waitUntil: 'networkidle' })
    await page.waitForURL(new RegExp(`/files/frontend/src/app\\.tsx\\?line=${targetLine}$`), { timeout: 20000 })
    await page.getByText(APP_TARGET_TEXT, { exact: false }).waitFor({ state: 'visible', timeout: 15000 })
    result.openFile.resolvedUrl = page.url()
    result.openFile.workspaceRoot = await page.evaluate(() => {
      const raw = localStorage.getItem('code-viewer:selected-workspace')
      if (!raw) return null
      return JSON.parse(raw).rootPath ?? null
    })
    result.openFile.listWorkspacesResult = consoleLines.some((line) => line.includes('connection.listWorkspaces.result'))
    result.openFile.selectWorkspaceResult = consoleLines.some((line) => line.includes('connection.selectWorkspace.result'))
    result.openFile.highlightRuleFound = await page.evaluate((line) => {
      return [...document.querySelectorAll('style')].some((el) => el.textContent?.includes(`.line:nth-child(${line})`))
    }, targetLine)
    assert(result.openFile.workspaceRoot === WORKSPACE_PATH, 'Resolver did not bind to the expected workspace')
    assert(result.openFile.listWorkspacesResult, 'Missing connection.listWorkspaces.result during /open/file resolve')
    assert(result.openFile.selectWorkspaceResult, 'Missing connection.selectWorkspace.result during /open/file resolve')
    assert(result.openFile.highlightRuleFound, 'URL line did not produce a highlight rule in the code viewer')
    await page.screenshot({ path: SCREENSHOT_OPEN_FILE, fullPage: true })

    await page.getByRole('button', { name: 'Tours' }).click()
    await page.waitForURL(/\/tours$/, { timeout: 15000 })
    await page.locator('button', { hasText: TOUR_TITLE }).first().click()
    await page.waitForURL(new RegExp(`/tours/${TOUR_ID}`), { timeout: 15000 })
    await page.getByRole('button', { name: 'Next' }).click()
    await page.waitForURL(new RegExp(`/tours/${TOUR_ID}\\?step=2$`), { timeout: 15000 })
    result.tourDetour.stepUrl = page.url()
    await page.getByRole('button', { name: 'View in Code Viewer' }).click()
    await page.waitForURL(/\/files\/frontend\/src\/pages\/tours\/tour-detail\.tsx\?line=/, { timeout: 15000 })
    await page.getByRole('button', { name: 'Back to Tour' }).waitFor({ state: 'visible', timeout: 15000 })
    result.tourDetour.codeUrl = page.url()
    await page.screenshot({ path: SCREENSHOT_TOUR_CODE, fullPage: true })
    await page.getByRole('button', { name: 'Back to Tour' }).click()
    await page.waitForURL(new RegExp(`/tours/${TOUR_ID}\\?step=2$`), { timeout: 15000 })
    result.tourDetour.unwindUrl = page.url()
    await page.goForward({ waitUntil: 'networkidle' })
    await page.waitForURL(/\/files\/frontend\/src\/pages\/tours\/tour-detail\.tsx\?line=/, { timeout: 15000 })
    await page.getByRole('button', { name: 'Back to Tour' }).waitFor({ state: 'visible', timeout: 15000 })
    result.tourDetour.forwardUrl = page.url()
    assert(result.tourDetour.unwindUrl === result.tourDetour.stepUrl, 'Back to Tour did not unwind to the original tour step URL')
    assert(result.tourDetour.forwardUrl === result.tourDetour.codeUrl, 'Browser forward did not restore the code detour entry')

    await page.getByRole('button', { name: 'Git' }).click()
    await page.waitForURL(/\/git$/, { timeout: 15000 })
    const commitButton = page.locator('button', { hasText: headCommitShort }).first()
    await commitButton.waitFor({ state: 'visible', timeout: 15000 })
    await commitButton.click()
    const gitFileButton = page.locator('button', { hasText: GIT_TARGET_FILE }).first()
    await gitFileButton.waitFor({ state: 'visible', timeout: 20000 })
    await gitFileButton.click()
    await page.waitForURL(new RegExp(`/git/diff/packages/cli/src/index\\.ts\\?commit=${headCommit}`), { timeout: 15000 })
    result.gitDetour.diffUrl = page.url()
    await page.getByRole('button', { name: 'View in Code' }).click()
    await page.waitForURL(/\/files\/packages\/cli\/src\/index\.ts\?line=/, { timeout: 15000 })
    await page.getByRole('button', { name: 'Back to Diff' }).waitFor({ state: 'visible', timeout: 15000 })
    result.gitDetour.codeUrl = page.url()
    await page.screenshot({ path: SCREENSHOT_GIT_CODE, fullPage: true })
    await page.getByRole('button', { name: 'Back to Diff' }).click()
    await page.waitForURL(new RegExp(`/git/diff/packages/cli/src/index\\.ts\\?commit=${headCommit}`), { timeout: 15000 })
    result.gitDetour.unwindUrl = page.url()
    await page.goForward({ waitUntil: 'networkidle' })
    await page.waitForURL(/\/files\/packages\/cli\/src\/index\.ts\?line=/, { timeout: 15000 })
    await page.getByRole('button', { name: 'Back to Diff' }).waitFor({ state: 'visible', timeout: 15000 })
    result.gitDetour.forwardUrl = page.url()
    result.gitDetour.gitDiffResult = consoleLines.some((line) => line.includes('git.diff.result'))
    assert(result.gitDetour.gitDiffResult, 'Missing git.diff.result in frontend console log')
    assert(result.gitDetour.unwindUrl === result.gitDetour.diffUrl, 'Back to Diff did not unwind to the original diff URL')
    assert(result.gitDetour.forwardUrl === result.gitDetour.codeUrl, 'Browser forward did not restore the diff detour code entry')

    await expectNoRuntimeErrors()

    result.pageErrors = pageErrors
    writeFileSync(RESULT_JSON, JSON.stringify(result, null, 2))
    await browser.close()
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    result.pageErrors = [...pageErrors, String(error)]
    writeFileSync(RESULT_JSON, JSON.stringify(result, null, 2))
    await browser.close()
    console.error(error)
    process.exit(1)
  }
}

main()
