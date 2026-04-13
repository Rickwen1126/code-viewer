import { chromium, devices } from '@playwright/test'
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { execFileSync } from 'child_process'

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
const IMAGE_PATH = `image-preview-${RUN_ID}.svg`
const VIDEO_PATH = `video-preview-${RUN_ID}.mp4`
const IMAGE_ABSOLUTE_PATH = join(WORKSPACE_PATH, IMAGE_PATH)
const VIDEO_ABSOLUTE_PATH = join(WORKSPACE_PATH, VIDEO_PATH)
const SVG_CONTENT = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80" viewBox="0 0 120 80"><rect width="120" height="80" fill="#1e3a5f"/><circle cx="40" cy="40" r="18" fill="#4ec9b0"/><rect x="68" y="22" width="26" height="36" rx="6" fill="#e2b93d"/></svg>`

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

function prepareFixtures() {
  mkdirSync(dirname(IMAGE_ABSOLUTE_PATH), { recursive: true })
  writeFileSync(IMAGE_ABSOLUTE_PATH, SVG_CONTENT, 'utf8')
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-f', 'lavfi',
      '-i', 'color=c=#264f78:s=160x90:d=1',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      VIDEO_ABSOLUTE_PATH,
    ],
    { stdio: 'ignore' },
  )
}

function cleanupFixtures() {
  rmSync(IMAGE_ABSOLUTE_PATH, { force: true })
  rmSync(VIDEO_ABSOLUTE_PATH, { force: true })
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
  prepareFixtures()
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
    const imageUrl = `${BASE_URL}/open/file?workspace=${encodeURIComponent(workspaceKey)}&path=${encodeURIComponent(IMAGE_PATH)}`
    await page.goto(imageUrl, { waitUntil: 'networkidle' })
    await page.waitForURL(new RegExp(`/files/${IMAGE_PATH.replace('.', '\\.')}$`), { timeout: 15000 })
    await page.locator(`img[alt="${IMAGE_PATH}"]`).waitFor({ state: 'visible', timeout: 15000 })
    result.image.url = page.url()
    result.image.blobUrl = await page.locator(`img[alt="${IMAGE_PATH}"]`).evaluate((element) => element.getAttribute('src'))
    result.image.rendered = await page.locator(`img[alt="${IMAGE_PATH}"]`).evaluate((element) => element.clientWidth > 0 && element.clientHeight > 0)
    await page.screenshot({ path: IMAGE_SCREENSHOT, fullPage: true })
    assert(result.image.url === `${BASE_URL}/files/${IMAGE_PATH}`, 'Image preview did not resolve to the file route')
    assert(typeof result.image.blobUrl === 'string' && result.image.blobUrl.startsWith('blob:'), 'Image preview was not loaded via a blob URL')
    assert(result.image.rendered, 'Image preview element did not render')

    const videoUrl = `${BASE_URL}/open/file?workspace=${encodeURIComponent(workspaceKey)}&path=${encodeURIComponent(VIDEO_PATH)}`
    await page.goto(videoUrl, { waitUntil: 'networkidle' })
    await page.waitForURL(new RegExp(`/files/${VIDEO_PATH.replace('.', '\\.')}$`), { timeout: 15000 })
    await page.locator('video').waitFor({ state: 'visible', timeout: 15000 })
    result.video.url = page.url()
    result.video.blobUrl = await page.locator('video').evaluate((element) => element.currentSrc)
    result.video.rendered = await page.locator('video').evaluate((element) => element.readyState >= 1)
    await page.screenshot({ path: VIDEO_SCREENSHOT, fullPage: true })
    assert(result.video.url === `${BASE_URL}/files/${VIDEO_PATH}`, 'Video preview did not resolve to the file route')
    assert(typeof result.video.blobUrl === 'string' && result.video.blobUrl.startsWith('blob:'), 'Video preview was not loaded via a blob URL')
    assert(result.video.rendered, 'Video preview did not reach metadata-ready state')

    const previewErrors = consoleLines.filter((line) => line.includes('file.preview.error') || line.includes('[ws] ⇐ ERROR'))
    assert(previewErrors.length === 0, `Unexpected preview errors:\n${previewErrors.join('\n')}`)
    assert(pageErrors.length === 0, `Unexpected page errors:\n${pageErrors.join('\n')}`)

    result.pageErrors = pageErrors
    writeFileSync(RESULT_JSON, JSON.stringify(result, null, 2))
    await browser.close()
    cleanupFixtures()
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    result.pageErrors = [...pageErrors, String(error)]
    writeFileSync(RESULT_JSON, JSON.stringify(result, null, 2))
    await browser.close()
    cleanupFixtures()
    console.error(error)
    process.exit(1)
  }
}

main()
