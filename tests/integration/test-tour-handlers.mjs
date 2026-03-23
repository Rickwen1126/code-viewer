#!/usr/bin/env node
/**
 * Integration test for CodeTour Layer 1 handlers.
 * Connects to backend WS, selects workspace, runs all tour operations.
 *
 * Usage: node tests/integration/test-tour-handlers.mjs
 * Prereqs: backend :4800 + extension connected
 */
import { randomUUID } from 'crypto'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const WebSocket = require('../../extension/node_modules/ws')

const WS_URL = 'ws://localhost:4800/ws/frontend'
const TIMEOUT = 10_000

// ── Helpers ──

function createMsg(type, payload = {}) {
  return JSON.stringify({
    type,
    id: randomUUID(),
    payload,
    timestamp: Date.now(),
  })
}

function waitForMsg(ws, replyTo, timeoutMs = TIMEOUT) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for reply to ${replyTo}`)), timeoutMs)
    const handler = (raw) => {
      const msg = JSON.parse(raw.toString())
      if (msg.replyTo === replyTo || msg.id === replyTo) {
        clearTimeout(timer)
        ws.removeListener('message', handler)
        resolve(msg)
      }
    }
    ws.on('message', handler)
  })
}

async function send(ws, type, payload = {}) {
  const msg = JSON.parse(createMsg(type, payload))
  ws.send(JSON.stringify(msg))
  const response = await waitForMsg(ws, msg.id)
  return response
}

// ── Test runner ──

let passed = 0
let failed = 0
const results = []

async function test(name, fn) {
  try {
    await fn()
    passed++
    results.push({ name, status: 'PASS' })
    console.log(`  ✅ ${name}`)
  } catch (err) {
    failed++
    results.push({ name, status: 'FAIL', error: err.message })
    console.log(`  ❌ ${name}: ${err.message}`)
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg)
}

// ── Main ──

async function main() {
  console.log('\n🔌 Connecting to', WS_URL)
  const ws = new WebSocket(WS_URL)

  await new Promise((resolve, reject) => {
    ws.on('open', resolve)
    ws.on('error', reject)
    setTimeout(() => reject(new Error('Connection timeout')), 5000)
  })

  // Wait for welcome
  await new Promise((resolve) => {
    ws.once('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      console.log('📨 Welcome:', msg.type)
      resolve()
    })
  })

  // List workspaces
  console.log('\n📋 Listing workspaces...')
  const listRes = await send(ws, 'connection.listWorkspaces')
  const workspaces = listRes.payload.workspaces
  console.log(`   Found ${workspaces.length} workspace(s):`, workspaces.map(w => w.displayName).join(', '))

  // Select code-viewer workspace
  const codeViewerWs = workspaces.find(w => w.displayName?.includes('code-viewer') || w.rootPath?.includes('code-viewer'))
  if (!codeViewerWs) {
    console.error('❌ code-viewer workspace not found!')
    ws.close()
    process.exit(1)
  }

  console.log(`\n🎯 Selecting workspace: ${codeViewerWs.displayName} (${codeViewerWs.extensionId})`)
  const selectRes = await send(ws, 'connection.selectWorkspace', { extensionId: codeViewerWs.extensionId })
  assert(selectRes.type === 'connection.selectWorkspace.result', `Expected selectWorkspace result, got ${selectRes.type}`)

  // ── Tour Tests ──
  console.log('\n🧪 Running tour handler tests...\n')

  const TEST_TOUR_TITLE = `Integration Test ${Date.now()}`
  let tourId

  // 1. tour.list (baseline)
  await test('tour.list returns tours array', async () => {
    const res = await send(ws, 'tour.list')
    assert(res.type === 'tour.list.result', `Expected tour.list.result, got ${res.type}`)
    assert(Array.isArray(res.payload.tours), 'tours should be an array')
    // Check existing tours have ref field
    if (res.payload.tours.length > 0) {
      const t = res.payload.tours[0]
      assert('ref' in t || t.ref === undefined, 'tours should have ref field')
    }
  })

  // 2. tour.create
  await test('tour.create creates a new recording tour', async () => {
    const res = await send(ws, 'tour.create', { title: TEST_TOUR_TITLE })
    assert(res.type === 'tour.create.result', `Expected result, got ${res.type}: ${JSON.stringify(res.payload)}`)
    assert(res.payload.tourId, 'should return tourId')
    assert(res.payload.filePath.endsWith('.tour'), 'should return filePath')
    tourId = res.payload.tourId
    console.log(`      → tourId: ${tourId}`)
  })

  // 3. tour.list shows recording status
  await test('tour.list shows new tour with status=recording', async () => {
    const res = await send(ws, 'tour.list')
    const tour = res.payload.tours.find(t => t.id === tourId)
    assert(tour, `Tour ${tourId} should be in list`)
    assert(tour.status === 'recording', `status should be "recording", got "${tour.status}"`)
    assert(tour.ref, 'should have a ref (branch name)')
    console.log(`      → ref: ${tour.ref}, status: ${tour.status}`)
  })

  // 4. tour.create rejects second recording
  await test('tour.create rejects when another tour is recording', async () => {
    const res = await send(ws, 'tour.create', { title: 'Should Fail' })
    assert(res.type === 'tour.create.error', `Expected error, got ${res.type}`)
    assert(res.payload.code === 'TOUR_RECORDING_EXISTS', `Expected TOUR_RECORDING_EXISTS, got ${res.payload.code}`)
  })

  // 5. tour.addStep
  await test('tour.addStep appends a step', async () => {
    const res = await send(ws, 'tour.addStep', {
      tourId,
      file: 'package.json',
      line: 1,
      description: 'Root package.json — monorepo config',
    })
    assert(res.type === 'tour.addStep.result', `Expected result, got ${res.type}: ${JSON.stringify(res.payload)}`)
    assert(res.payload.stepCount === 1, `stepCount should be 1, got ${res.payload.stepCount}`)
  })

  // 6. tour.addStep with index
  await test('tour.addStep inserts at index 0', async () => {
    const res = await send(ws, 'tour.addStep', {
      tourId,
      file: 'README.md',
      line: 1,
      description: 'README — project overview',
      index: 0,
    })
    assert(res.type === 'tour.addStep.result', `Expected result, got ${res.type}`)
    assert(res.payload.stepCount === 2, `stepCount should be 2, got ${res.payload.stepCount}`)
  })

  // 7. tour.getSteps
  await test('tour.getSteps returns steps with ref', async () => {
    const res = await send(ws, 'tour.getSteps', { tourId })
    assert(res.type === 'tour.getSteps.result', `Expected result, got ${res.type}`)
    assert(res.payload.tour.ref, 'tour should have ref')
    assert(res.payload.steps.length === 2, `should have 2 steps, got ${res.payload.steps.length}`)
    assert(res.payload.steps[0].file === 'README.md', 'first step should be README.md (inserted at index 0)')
    assert(res.payload.steps[1].file === 'package.json', 'second step should be package.json')
    console.log(`      → ref: ${res.payload.tour.ref}, steps: ${res.payload.steps.map(s => s.file).join(', ')}`)
  })

  // 8. tour.deleteStep
  await test('tour.deleteStep removes step at index 0', async () => {
    const res = await send(ws, 'tour.deleteStep', { tourId, stepIndex: 0 })
    assert(res.type === 'tour.deleteStep.result', `Expected result, got ${res.type}`)
    assert(res.payload.stepCount === 1, `stepCount should be 1, got ${res.payload.stepCount}`)
  })

  // 9. tour.deleteStep out of bounds
  await test('tour.deleteStep rejects out of bounds', async () => {
    const res = await send(ws, 'tour.deleteStep', { tourId, stepIndex: 99 })
    assert(res.type === 'tour.deleteStep.error', `Expected error, got ${res.type}`)
    assert(res.payload.code === 'TOUR_STEP_OUT_OF_BOUNDS', `Expected TOUR_STEP_OUT_OF_BOUNDS, got ${res.payload.code}`)
  })

  // 10. tour.getFileAtRef (working tree)
  await test('tour.getFileAtRef reads working tree when ref=null', async () => {
    const res = await send(ws, 'tour.getFileAtRef', { ref: null, path: 'package.json' })
    assert(res.type === 'tour.getFileAtRef.result', `Expected result, got ${res.type}: ${JSON.stringify(res.payload?.code)}`)
    assert(res.payload.content.includes('code-viewer'), 'content should contain "code-viewer"')
    assert(res.payload.languageId === 'json', `languageId should be json, got ${res.payload.languageId}`)
    assert(res.payload.ref === null, 'ref should be null')
  })

  // 11. tour.getFileAtRef (git ref)
  await test('tour.getFileAtRef reads file at git ref', async () => {
    const res = await send(ws, 'tour.getFileAtRef', { ref: 'HEAD', path: 'package.json' })
    assert(res.type === 'tour.getFileAtRef.result', `Expected result, got ${res.type}: ${JSON.stringify(res.payload?.code)}`)
    assert(res.payload.content.includes('code-viewer'), 'content should contain "code-viewer"')
    assert(res.payload.ref === 'HEAD', 'ref should echo back HEAD')
  })

  // 12. tour.getFileAtRef bad ref
  await test('tour.getFileAtRef rejects bad ref', async () => {
    const res = await send(ws, 'tour.getFileAtRef', { ref: 'nonexistent-branch-xyz', path: 'package.json' })
    assert(res.type === 'tour.getFileAtRef.error', `Expected error, got ${res.type}`)
    assert(
      res.payload.code === 'TOUR_REF_NOT_FOUND' || res.payload.code === 'TOUR_FILE_NOT_AT_REF',
      `Expected TOUR_REF_NOT_FOUND or TOUR_FILE_NOT_AT_REF, got ${res.payload.code}`
    )
  })

  // 13. git.status has commitHash
  await test('git.status includes commitHash', async () => {
    const res = await send(ws, 'git.status')
    assert(res.type === 'git.status.result', `Expected result, got ${res.type}`)
    assert(typeof res.payload.commitHash === 'string', 'commitHash should be a string')
    assert(res.payload.commitHash.length > 0, 'commitHash should not be empty')
    console.log(`      → branch: ${res.payload.branch}, commitHash: ${res.payload.commitHash.slice(0, 8)}...`)
  })

  // 14. tour.finalize
  await test('tour.finalize removes recording status', async () => {
    const res = await send(ws, 'tour.finalize', { tourId })
    assert(res.type === 'tour.finalize.result', `Expected result, got ${res.type}: ${JSON.stringify(res.payload)}`)
    assert(res.payload.ok === true, 'should return ok: true')
  })

  // 15. Verify finalized tour has no status
  await test('finalized tour has no status in tour.list', async () => {
    const res = await send(ws, 'tour.list')
    const tour = res.payload.tours.find(t => t.id === tourId)
    assert(tour, 'tour should still exist')
    assert(!tour.status, `status should be absent, got "${tour.status}"`)
  })

  // 16. tour.finalize rejects already finalized
  await test('tour.finalize rejects non-recording tour', async () => {
    const res = await send(ws, 'tour.finalize', { tourId })
    assert(res.type === 'tour.finalize.error', `Expected error, got ${res.type}`)
    assert(res.payload.code === 'TOUR_NOT_RECORDING', `Expected TOUR_NOT_RECORDING, got ${res.payload.code}`)
  })

  // 17. tour.delete
  await test('tour.delete removes the tour file', async () => {
    const res = await send(ws, 'tour.delete', { tourId })
    assert(res.type === 'tour.delete.result', `Expected result, got ${res.type}: ${JSON.stringify(res.payload)}`)
    assert(res.payload.ok === true, 'should return ok: true')
  })

  // 18. Verify deleted tour is gone
  await test('deleted tour is gone from tour.list', async () => {
    const res = await send(ws, 'tour.list')
    const tour = res.payload.tours.find(t => t.id === tourId)
    assert(!tour, 'tour should not be in list after delete')
  })

  // 19. tour.delete rejects non-existent
  await test('tour.delete rejects non-existent tour', async () => {
    const res = await send(ws, 'tour.delete', { tourId: 'ghost-tour-xyz' })
    assert(res.type === 'tour.delete.error', `Expected error, got ${res.type}`)
    assert(res.payload.code === 'NOT_FOUND', `Expected NOT_FOUND, got ${res.payload.code}`)
  })

  // ── Summary ──
  console.log('\n' + '═'.repeat(50))
  console.log(`📊 Results: ${passed} passed, ${failed} failed (${passed + failed} total)`)
  if (failed > 0) {
    console.log('\nFailed tests:')
    results.filter(r => r.status === 'FAIL').forEach(r => console.log(`  ❌ ${r.name}: ${r.error}`))
  }
  console.log('═'.repeat(50) + '\n')

  ws.close()
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
