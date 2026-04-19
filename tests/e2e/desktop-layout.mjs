/**
 * Desktop Layout E2E — code-viewer desktop UI verification
 *
 * Viewport: 1280 × 800 (≥ 1024px triggers desktop layout)
 * Requires: backend :4800 + frontend :4801 running, ≥ 1 VS Code extension connected
 *
 * Checklist:
 * DT-01  Desktop shell renders (ActivityBar 48px + SidebarPanel + main content area)
 * DT-02  ActivityBar tab navigation switches sidebar content
 * DT-03  File browser sidebar loads tree, click file opens code viewer in main
 * DT-04  Tours sidebar loads list, expand tour loads steps
 * DT-05  Tour steps survive sidebar remount (files tab → tours tab round-trip)
 * DT-06  WorkspacePopover opens on bottom icon click, closes on Escape
 * DT-07  WS console log integrity (no errors throughout)
 */
import { chromium } from '@playwright/test'
import { appendFileSync, writeFileSync, mkdirSync } from 'fs'

const BASE_URL = 'http://127.0.0.1:4801'
const WORKSPACE_PATH = '/Users/rickwen/code/code-viewer'
const RUN_ID = `${Date.now()}`

const OUTPUT_DIR = '/private/tmp/claude-501'
try { mkdirSync(OUTPUT_DIR, { recursive: true }) } catch {}
const CONSOLE_LOG = `${OUTPUT_DIR}/codeview-e2e-desktop-console-${RUN_ID}.log`
const RESULT_JSON = `${OUTPUT_DIR}/codeview-e2e-desktop-result-${RUN_ID}.json`
const SCREENSHOT = (name) => `${OUTPUT_DIR}/codeview-e2e-desktop-${name}-${RUN_ID}.png`

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

async function findWorkspace(rootPath) {
  const response = await fetch('http://127.0.0.1:4800/admin/workspaces')
  if (!response.ok) throw new Error(`admin/workspaces: ${response.status}`)
  const payload = await response.json()
  const ws = payload.workspaces?.find((e) => e.rootPath === rootPath)
  if (!ws?.workspaceKey) throw new Error(`No workspace for ${rootPath}`)
  return ws
}

async function main() {
  const adminWorkspace = await findWorkspace(WORKSPACE_PATH)
  const workspaceKey = adminWorkspace.workspaceKey

  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  })

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
  })
  const page = await context.newPage()

  page.on('console', (msg) => logLine(`[console:${msg.type()}] ${msg.text()}`))
  page.on('pageerror', (error) => {
    const line = `[pageerror] ${error.message}`
    pageErrors.push(line)
    logLine(line)
  })

  // Pre-seed workspace in localStorage so the app auto-selects it on load.
  // WorkspaceProvider reads this, matches against live list, and calls selectWorkspace.
  await page.addInitScript(({ ws }) => {
    if (sessionStorage.getItem('code-viewer:e2e-desktop-init') === 'done') return
    sessionStorage.setItem('code-viewer:e2e-desktop-init', 'done')
    localStorage.setItem('code-viewer:debug', 'true')
    localStorage.removeItem('code-viewer:last-location')
    localStorage.removeItem('code-viewer:current-file')
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('code-viewer:current-file:')) localStorage.removeItem(key)
    }
    // Seed workspace — findMatchingWorkspace matches by workspaceKey
    localStorage.setItem('code-viewer:selected-workspace', JSON.stringify({
      extensionId: ws.extensionId ?? 'seed',
      workspaceKey: ws.workspaceKey,
      name: ws.name ?? 'code-viewer',
      rootPath: ws.rootPath,
      gitBranch: null,
      vscodeVersion: '0',
      extensionVersion: '0',
    }))
  }, { ws: adminWorkspace })

  const result = {
    runId: RUN_ID,
    workspaceKey,
    checks: {},
    consoleLog: CONSOLE_LOG,
    pageErrors: [],
  }

  try {
    // ───────────────────────────────────────────────────
    // DT-01  Desktop shell renders
    // ───────────────────────────────────────────────────
    await page.goto(`${BASE_URL}/files/frontend/src/app.tsx`, {
      waitUntil: 'networkidle',
    })
    // Wait for workspace auto-bind + file load
    await page.waitForURL(/\/files\/frontend\/src\/app\.tsx/, { timeout: 20000 })

    // Verify 3-column layout: ActivityBar (nav) + SidebarPanel + main
    const activityBar = page.locator('nav').first()
    await activityBar.waitFor({ state: 'visible', timeout: 10000 })
    const abBox = await activityBar.boundingBox()
    assert(abBox && abBox.width >= 44 && abBox.width <= 52, `ActivityBar width expected ~48px, got ${abBox?.width}`)

    // Sidebar: the div between nav and main — find it by structure
    const sidebarWidth = await page.evaluate(() => {
      const nav = document.querySelector('nav')
      if (!nav) return 0
      const sibling = nav.nextElementSibling
      return sibling ? sibling.getBoundingClientRect().width : 0
    })
    assert(sidebarWidth >= 200 && sidebarWidth <= 480, `SidebarPanel width expected 200–480px, got ${sidebarWidth}`)

    // Main content area exists and has code
    const mainContent = page.locator('main').first()
    await mainContent.waitFor({ state: 'visible', timeout: 5000 })
    const mainBox = await mainContent.boundingBox()
    assert(mainBox && mainBox.width > 400, `Main content area too narrow: ${mainBox?.width}`)

    // Verify code actually rendered (not just empty main)
    await page.locator('[data-testid="shiki-container"]').first().waitFor({ state: 'visible', timeout: 15000 })

    await page.screenshot({ path: SCREENSHOT('01-shell'), fullPage: false })
    result.checks['DT-01'] = { pass: true, activityBarWidth: abBox.width, sidebarWidth, mainWidth: mainBox.width }
    console.log('✓ DT-01  Desktop shell renders')

    // ───────────────────────────────────────────────────
    // DT-02  ActivityBar tab navigation
    // ───────────────────────────────────────────────────

    // Currently on /files/* — sidebar should show file tree
    const fileSearchInput = page.locator('input[placeholder="Search files..."]').first()
    await fileSearchInput.waitFor({ state: 'visible', timeout: 5000 })

    // Click Tours tab
    const toursBtn = page.locator('button[title="Tours"]')
    await toursBtn.click()
    await page.waitForURL(/\/tours/, { timeout: 10000 })
    // Sidebar should now show Tours header
    const toursHeader = page.locator('text=Tours').first()
    await toursHeader.waitFor({ state: 'visible', timeout: 5000 })

    // Click Git tab
    const gitBtn = page.locator('button[title="Git"]')
    await gitBtn.click()
    await page.waitForURL(/\/git/, { timeout: 10000 })

    // Click Files tab to go back
    const filesBtn = page.locator('button[title="Files"]')
    await filesBtn.click()
    await page.waitForURL(/\/files/, { timeout: 10000 })
    await fileSearchInput.waitFor({ state: 'visible', timeout: 5000 })

    // Verify active tab indicator: Files tab should have blue left border
    const filesTabBorderLeft = await filesBtn.evaluate((el) => getComputedStyle(el).borderLeft)
    assert(filesTabBorderLeft.includes('rgb(86, 156, 214)'), `Files tab active indicator missing, got: ${filesTabBorderLeft}`)

    result.checks['DT-02'] = { pass: true }
    console.log('✓ DT-02  ActivityBar tab navigation')

    // ───────────────────────────────────────────────────
    // DT-03  File browser sidebar → code viewer
    // ───────────────────────────────────────────────────

    // Navigate directly to the file route (workspace already bound from DT-01)
    await page.goto(`${BASE_URL}/files/frontend/src/app.tsx`, { waitUntil: 'networkidle' })
    await page.waitForURL(/\/files\/.*app\.tsx/, { timeout: 20000 })
    await page.locator('[data-testid="shiki-container"]').first().waitFor({ state: 'visible', timeout: 15000 })

    // Verify file content rendered (data-level: check actual code text)
    const codeText = await page.locator('[data-testid="shiki-container"]').first().textContent()
    assert(codeText && codeText.includes('BrowserRouter'), `Code content missing expected text "BrowserRouter"`)

    // Wait for file tree to stabilize — sidebar needs ≥ 1 re-render after CodeViewerPage
    // writes currentFile to localStorage. Tree load triggers that re-render.
    await page.locator('text=code-viewer').first().waitFor({ state: 'visible', timeout: 15000 })

    // Poll for active file highlight (sidebar re-renders async after tree load)
    // Filter: must have non-empty text (ActivityBar icons also have blue border but no text)
    let activeFileBtn = null
    for (let attempt = 0; attempt < 10; attempt++) {
      activeFileBtn = await page.evaluate(() => {
        const buttons = [...document.querySelectorAll('button')]
        const active = buttons.find((b) => {
          const bl = b.style.borderLeft || ''
          const text = b.textContent?.trim() || ''
          return text.length > 0 && (bl.includes('#569cd6') || bl.includes('rgb(86, 156, 214)'))
        })
        return active ? active.textContent?.trim() : null
      })
      if (activeFileBtn && activeFileBtn.includes('app.tsx')) break
      await page.waitForTimeout(500)
    }
    assert(activeFileBtn && activeFileBtn.includes('app.tsx'), `Active file highlight not found or wrong file: "${activeFileBtn}"`)

    await page.screenshot({ path: SCREENSHOT('03-file-viewer'), fullPage: false })
    result.checks['DT-03'] = { pass: true, activeFile: activeFileBtn, hasCodeContent: true }
    console.log('✓ DT-03  File browser sidebar → code viewer')

    // ───────────────────────────────────────────────────
    // DT-04  Tours sidebar loads list, expand → steps
    // ───────────────────────────────────────────────────

    await toursBtn.click()
    await page.waitForURL(/\/tours/, { timeout: 10000 })
    await page.locator('text=Tours').first().waitFor({ state: 'visible', timeout: 5000 })

    // Wait for tour list to load (at least one tour should exist)
    const firstTour = page.locator('button').filter({ hasText: /\d+ steps?/ }).first()
    await firstTour.waitFor({ state: 'visible', timeout: 15000 })

    // Get tour title before expanding
    const tourRowText = await firstTour.textContent()

    // Click to expand
    await firstTour.click()

    // Wait for steps to load (either step items or "No steps")
    // Steps have numbered format like "1." at the start
    const stepsOrEmpty = page.locator('button span').filter({ hasText: /^\d+\.$/ }).first()
      .or(page.locator('text=No steps'))
    await stepsOrEmpty.waitFor({ state: 'visible', timeout: 15000 })

    // Verify "Loading steps..." is gone
    const loadingSteps = await page.locator('text=Loading steps...').count()
    assert(loadingSteps === 0, 'Steps still showing "Loading steps..." after expand')

    // If steps exist, click the first one to navigate
    const stepButtons = page.locator('button span').filter({ hasText: /^\d+\.$/ })
    const stepCount = await stepButtons.count()
    let navigatedTourId = null

    if (stepCount > 0) {
      // Click the parent button of the step number
      const firstStepBtn = stepButtons.first().locator('..')
      await firstStepBtn.click()
      await page.waitForURL(/\/tours\/[^/]+\?step=/, { timeout: 10000 })
      navigatedTourId = page.url().match(/\/tours\/([^?]+)/)?.[1]

      // Main content should show tour detail
      const prevBtn = page.locator('button', { hasText: 'Prev' }).first()
      await prevBtn.waitFor({ state: 'visible', timeout: 10000 })
    }

    result.checks['DT-04'] = { pass: true, tourTitle: tourRowText, stepCount, navigatedTourId }
    console.log(`✓ DT-04  Tours sidebar expand + steps (${stepCount} steps found)`)

    // ───────────────────────────────────────────────────
    // DT-05  Tour steps survive sidebar remount
    // ───────────────────────────────────────────────────

    if (navigatedTourId && stepCount > 0) {
      // Currently on /tours/:id?step=1 with tour expanded in sidebar
      // Step 1: Switch to Files tab via click (ToursSidebar unmounts, FileBrowserSidebar mounts)
      await filesBtn.click()
      await page.waitForURL(/\/files/, { timeout: 10000 })
      await fileSearchInput.waitFor({ state: 'visible', timeout: 5000 })

      // Step 2: Switch back to Tours tab via click (ToursSidebar remounts from scratch)
      await toursBtn.click()
      await page.waitForURL(/\/tours/, { timeout: 10000 })

      // Step 3: Click the same tour to navigate back to it (SPA navigation, not page.goto)
      // Re-find the tour in the list and click it
      const tourForRemount = page.locator('button').filter({ hasText: /\d+ steps?/ }).first()
      await tourForRemount.waitFor({ state: 'visible', timeout: 15000 })
      await tourForRemount.click()

      // Wait for step navigation
      const stepBtnRemount = page.locator('button span').filter({ hasText: /^\d+\.$/ }).first()
        .or(page.locator('text=No steps'))
      await stepBtnRemount.waitFor({ state: 'visible', timeout: 15000 })

      // Click a step to navigate to tour detail (establishes activeTourId in URL)
      const firstStepRemount = page.locator('button span').filter({ hasText: /^\d+\.$/ }).first().locator('..')
      const hasSteps = await page.locator('button span').filter({ hasText: /^\d+\.$/ }).count()
      if (hasSteps > 0) {
        await firstStepRemount.click()
        await page.waitForURL(/\/tours\/[^/]+\?step=/, { timeout: 10000 })
      }

      // Step 4: The real remount test — switch to files and back with a tour URL active
      await filesBtn.click()
      await page.waitForURL(/\/files/, { timeout: 10000 })
      await fileSearchInput.waitFor({ state: 'visible', timeout: 5000 })

      // Navigate back to tours — sidebar remounts with activeTourId from URL
      await page.goBack()
      await page.waitForURL(/\/tours\//, { timeout: 10000 })

      // Wait for auto-expand + step loading (the bug fix we're testing)
      await page.waitForTimeout(3000)

      const loadingAfterRemount = await page.locator('text=Loading steps...').count()
      assert(loadingAfterRemount === 0, 'BUG: Tour steps stuck on "Loading steps..." after sidebar remount')

      // Verify steps are actually visible in the sidebar
      const stepsAfterRemount = await page.locator('button span').filter({ hasText: /^\d+\.$/ }).count()
      assert(stepsAfterRemount > 0, `Steps not visible after remount, expected > 0, got ${stepsAfterRemount}`)

      await page.screenshot({ path: SCREENSHOT('05-remount'), fullPage: false })
      result.checks['DT-05'] = { pass: true, stepsAfterRemount }
      console.log(`✓ DT-05  Tour steps survive sidebar remount (${stepsAfterRemount} steps visible)`)
    } else {
      result.checks['DT-05'] = { pass: true, skipped: true, reason: 'No tour steps to test' }
      console.log('⊘ DT-05  Tour steps remount (skipped: no tour steps available)')
    }

    // ───────────────────────────────────────────────────
    // DT-06  WorkspacePopover
    // ───────────────────────────────────────────────────

    // Click workspace icon (bottom of activity bar)
    const wsBtn = page.locator('button[title="Switch workspace"]')
    await wsBtn.click()

    // Popover should appear with workspace list
    // The popover is a fixed-position div with workspace entries
    // Wait for at least one workspace entry or loading state to clear
    await page.waitForTimeout(1000)

    // Check popover is visible — look for the popover container (fixed position, bottom-left)
    const popoverVisible = await page.evaluate(() => {
      const els = [...document.querySelectorAll('div')]
      return els.some((el) => {
        const style = el.style
        return style.position === 'fixed' && style.bottom === '8px' && style.left === '52px'
      })
    })
    assert(popoverVisible, 'WorkspacePopover did not appear')

    // Verify workspace list has at least 1 entry (data-level)
    const wsEntries = await page.evaluate(() => {
      const els = [...document.querySelectorAll('div')]
      const popover = els.find((el) => {
        const style = el.style
        return style.position === 'fixed' && style.bottom === '8px' && style.left === '52px'
      })
      if (!popover) return 0
      return popover.querySelectorAll('button').length
    })
    assert(wsEntries > 0, `WorkspacePopover has no workspace entries, got ${wsEntries}`)

    // Close with Escape
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    const popoverGone = await page.evaluate(() => {
      const els = [...document.querySelectorAll('div')]
      return !els.some((el) => {
        const style = el.style
        return style.position === 'fixed' && style.bottom === '8px' && style.left === '52px'
      })
    })
    assert(popoverGone, 'WorkspacePopover did not close on Escape')

    await page.screenshot({ path: SCREENSHOT('06-popover-closed'), fullPage: false })
    result.checks['DT-06'] = { pass: true, wsEntries }
    console.log(`✓ DT-06  WorkspacePopover (${wsEntries} workspace(s), Escape closes)`)

    // ───────────────────────────────────────────────────
    // DT-07  WS console log integrity
    // ───────────────────────────────────────────────────
    const wsErrors = consoleLines.filter((line) =>
      line.includes('[ws] ⇐ ERROR') || line.includes('[pageerror]'),
    )
    assert(wsErrors.length === 0, `Runtime errors detected:\n${wsErrors.join('\n')}`)

    result.checks['DT-07'] = { pass: true, totalConsoleLogs: consoleLines.length }
    console.log(`✓ DT-07  WS log integrity (${consoleLines.length} lines, 0 errors)`)

    // ───────────────────────────────────────────────────
    // Summary
    // ───────────────────────────────────────────────────
    const allChecks = Object.entries(result.checks)
    const passed = allChecks.filter(([, v]) => v.pass).length
    const total = allChecks.length
    console.log(`\n${passed}/${total} checks passed`)

    result.pageErrors = pageErrors
    writeFileSync(RESULT_JSON, JSON.stringify(result, null, 2))
    await browser.close()

    if (passed < total) process.exit(1)
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
