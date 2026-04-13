import { chromium, devices } from '@playwright/test'
import { appendFileSync, writeFileSync } from 'fs'

const BASE_URL = 'http://127.0.0.1:4801'
const BACKEND_URL = 'http://127.0.0.1:4800'
const WORKSPACE_PATH = process.argv[2]

if (!WORKSPACE_PATH) {
  console.error('Usage: node tests/e2e/media-preview.mjs <workspace-path>')
  process.exit(1)
}

const OUTPUT_DIR = '/private/tmp/claude-501'
const RUN_ID = `${Date.now()}`
const CONSOLE_LOG = `${OUTPUT_DIR}/codeview-e2e-media-preview-console-${RUN_ID}.log`
const RESULT_JSON = `${OUTPUT_DIR}/codeview-e2e-media-preview-result-${RUN_ID}.json`
const IMAGE_SCREENSHOT = `${OUTPUT_DIR}/codeview-e2e-media-preview-image-${RUN_ID}.png`
const VIDEO_SCREENSHOT = `${OUTPUT_DIR}/codeview-e2e-media-preview-video-${RUN_ID}.png`

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

async function main() {
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
    image: {
      url: null,
      blobUrl: null,
      rendered: false,
    },
    video: {
      url: null,
      blobUrl: null,
      rendered: false,
    },
    consoleLog: CONSOLE_LOG,
    pageErrors: [],
  }

  try {
    const imageUrl = `${BASE_URL}/open/file?workspace=${encodeURIComponent(workspaceKey)}&path=${encodeURIComponent('image.svg')}`
    await page.goto(imageUrl, { waitUntil: 'networkidle' })
    await page.waitForURL(/\/files\/image\.svg$/, { timeout: 15000 })
    await page.locator('img[alt="image.svg"]').waitFor({ state: 'visible', timeout: 15000 })
    result.image.url = page.url()
    result.image.blobUrl = await page.locator('img[alt="image.svg"]').evaluate((element) => element.getAttribute('src'))
    result.image.rendered = await page.locator('img[alt="image.svg"]').evaluate((element) => element.clientWidth > 0 && element.clientHeight > 0)
    await page.screenshot({ path: IMAGE_SCREENSHOT, fullPage: true })
    assert(result.image.url === `${BASE_URL}/files/image.svg`, 'Image preview did not resolve to the file route')
    assert(typeof result.image.blobUrl === 'string' && result.image.blobUrl.startsWith('blob:'), 'Image preview was not loaded via a blob URL')
    assert(result.image.rendered, 'Image preview element did not render')

    const videoUrl = `${BASE_URL}/open/file?workspace=${encodeURIComponent(workspaceKey)}&path=${encodeURIComponent('video.mp4')}`
    await page.goto(videoUrl, { waitUntil: 'networkidle' })
    await page.waitForURL(/\/files\/video\.mp4$/, { timeout: 15000 })
    await page.locator('video').waitFor({ state: 'visible', timeout: 15000 })
    result.video.url = page.url()
    result.video.blobUrl = await page.locator('video').evaluate((element) => element.currentSrc)
    result.video.rendered = await page.locator('video').evaluate((element) => element.readyState >= 1)
    await page.screenshot({ path: VIDEO_SCREENSHOT, fullPage: true })
    assert(result.video.url === `${BASE_URL}/files/video.mp4`, 'Video preview did not resolve to the file route')
    assert(typeof result.video.blobUrl === 'string' && result.video.blobUrl.startsWith('blob:'), 'Video preview was not loaded via a blob URL')
    assert(result.video.rendered, 'Video preview did not reach metadata-ready state')

    const previewErrors = consoleLines.filter((line) => line.includes('file.preview.error') || line.includes('[ws] ⇐ ERROR'))
    assert(previewErrors.length === 0, `Unexpected preview errors:\n${previewErrors.join('\n')}`)
    assert(pageErrors.length === 0, `Unexpected page errors:\n${pageErrors.join('\n')}`)

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
