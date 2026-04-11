import { describe, it, expect, beforeEach, vi, afterEach, type Mock } from 'vitest'

// ── Mock the manager module before importing relay ─────────────────
vi.mock('../ws/manager.js', () => {
  return {
    manager: {
      getFrontend: vi.fn(),
      getExtension: vi.fn(),
      getFrontendsForExtension: vi.fn(),
    },
  }
})

// Import AFTER the mock is set up so relay gets the mocked manager
import {
  relayFrontendToExtension,
  relayExtensionResponseToFrontend,
  broadcastExtensionEvent,
} from '../ws/relay.js'
import { manager } from '../ws/manager.js'

// ── Helpers ────────────────────────────────────────────────────────

function createMockWs() {
  const sent: string[] = []
  return {
    ws: { send: (data: string) => sent.push(data) },
    sent,
  }
}

let msgCounter = 0
function makeMsg(overrides: Partial<{ id: string; type: string; replyTo: string; payload: unknown }> = {}) {
  return {
    type: 'file.read',
    id: `msg-${++msgCounter}`,
    payload: { path: '/src/index.ts' },
    timestamp: Date.now(),
    ...overrides,
  }
}

// ── Tests ──────────────────────────────────────────────────────────

describe('relayFrontendToExtension', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('forwards the message to the extension ws when frontend has a selected workspace', () => {
    const { ws: feWs } = createMockWs()
    const { ws: extWs, sent: extSent } = createMockWs()

    ;(manager.getFrontend as Mock).mockReturnValue({ ws: feWs, selectedExtensionId: 'ext-1' })
    ;(manager.getExtension as Mock).mockReturnValue({ ws: extWs })

    const msg = makeMsg()
    relayFrontendToExtension('fe-1', msg)

    expect(extSent).toHaveLength(1)
    expect(JSON.parse(extSent[0])).toMatchObject({ id: msg.id, type: msg.type })
  })

  it('returns NOT_CONNECTED error when frontend has no workspace selected', () => {
    const { ws: feWs, sent: feSent } = createMockWs()

    ;(manager.getFrontend as Mock).mockReturnValue({ ws: feWs, selectedExtensionId: null })

    const msg = makeMsg()
    relayFrontendToExtension('fe-1', msg)

    expect(feSent).toHaveLength(1)
    const response = JSON.parse(feSent[0])
    expect(response.type).toBe('error')
    expect(response.replyTo).toBe(msg.id)
    expect(response.payload.code).toBe('NOT_CONNECTED')
  })

  it('returns EXTENSION_OFFLINE error when the extension is not found', () => {
    const { ws: feWs, sent: feSent } = createMockWs()

    // First call: getFrontend for existence check; returns selectedExtensionId
    // Second call: getFrontend for sending the error
    ;(manager.getFrontend as Mock).mockReturnValue({ ws: feWs, selectedExtensionId: 'ext-offline' })
    ;(manager.getExtension as Mock).mockReturnValue(undefined)

    const msg = makeMsg()
    relayFrontendToExtension('fe-1', msg)

    expect(feSent).toHaveLength(1)
    const response = JSON.parse(feSent[0])
    expect(response.type).toBe('error')
    expect(response.replyTo).toBe(msg.id)
    expect(response.payload.code).toBe('EXTENSION_OFFLINE')
  })

  it('does nothing when getFrontend returns undefined', () => {
    ;(manager.getFrontend as Mock).mockReturnValue(undefined)

    // Should not throw
    expect(() => relayFrontendToExtension('ghost', makeMsg())).not.toThrow()
  })

  it('sends TIMEOUT error after 30s when extension does not respond', () => {
    const { ws: feWs, sent: feSent } = createMockWs()
    const { ws: extWs } = createMockWs()

    ;(manager.getFrontend as Mock).mockReturnValue({ ws: feWs, selectedExtensionId: 'ext-1' })
    ;(manager.getExtension as Mock).mockReturnValue({ ws: extWs })

    const msg = makeMsg()
    relayFrontendToExtension('fe-1', msg)

    // No timeout yet
    vi.advanceTimersByTime(29999)
    expect(feSent).toHaveLength(0)

    // Trigger timeout
    vi.advanceTimersByTime(1)
    expect(feSent).toHaveLength(1)
    const response = JSON.parse(feSent[0])
    expect(response.type).toBe('error')
    expect(response.replyTo).toBe(msg.id)
    expect(response.payload.code).toBe('TIMEOUT')
  })

  it('registers a pending request so relayExtensionResponseToFrontend can route it', () => {
    const { ws: feWs } = createMockWs()
    const { ws: extWs } = createMockWs()

    ;(manager.getFrontend as Mock).mockReturnValue({ ws: feWs, selectedExtensionId: 'ext-1' })
    ;(manager.getExtension as Mock).mockReturnValue({ ws: extWs })

    const msg = makeMsg()
    relayFrontendToExtension('fe-1', msg)

    // Route the response back — should return true because pending entry exists
    const response = makeMsg({ id: 'resp-1', replyTo: msg.id })
    const routed = relayExtensionResponseToFrontend(response)
    expect(routed).toBe(true)
  })
})

describe('relayExtensionResponseToFrontend', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns false when replyTo is missing', () => {
    const msg = makeMsg() // no replyTo field
    expect(relayExtensionResponseToFrontend(msg)).toBe(false)
  })

  it('returns false when replyTo does not match any pending request', () => {
    const msg = makeMsg({ replyTo: 'nonexistent-id' })
    expect(relayExtensionResponseToFrontend(msg)).toBe(false)
  })

  it('routes the response to the correct frontend via replyTo', () => {
    const { ws: feWs, sent: feSent } = createMockWs()
    const { ws: extWs } = createMockWs()

    ;(manager.getFrontend as Mock).mockReturnValue({ ws: feWs, selectedExtensionId: 'ext-1' })
    ;(manager.getExtension as Mock).mockReturnValue({ ws: extWs })

    const req = makeMsg()
    relayFrontendToExtension('fe-1', req)

    // Extension responds
    const resp = makeMsg({ id: 'resp-1', type: 'file.read.result', replyTo: req.id, payload: { content: 'hello' } })
    const result = relayExtensionResponseToFrontend(resp)

    expect(result).toBe(true)
    expect(feSent).toHaveLength(1)
    expect(JSON.parse(feSent[0])).toMatchObject({ id: 'resp-1', replyTo: req.id })
  })

  it('clears the timeout when response arrives (no TIMEOUT error sent later)', () => {
    const { ws: feWs, sent: feSent } = createMockWs()
    const { ws: extWs } = createMockWs()

    ;(manager.getFrontend as Mock).mockReturnValue({ ws: feWs, selectedExtensionId: 'ext-1' })
    ;(manager.getExtension as Mock).mockReturnValue({ ws: extWs })

    const req = makeMsg()
    relayFrontendToExtension('fe-1', req)

    // Respond before timeout
    const resp = makeMsg({ id: 'resp-1', replyTo: req.id })
    relayExtensionResponseToFrontend(resp)

    // Now advance past the 30s timeout
    vi.advanceTimersByTime(31000)

    // Only the actual response should have been sent, not a TIMEOUT
    expect(feSent).toHaveLength(1)
    expect(JSON.parse(feSent[0]).payload?.code).not.toBe('TIMEOUT')
  })

  it('returns false on second call with same replyTo (pending entry removed)', () => {
    const { ws: feWs } = createMockWs()
    const { ws: extWs } = createMockWs()

    ;(manager.getFrontend as Mock).mockReturnValue({ ws: feWs, selectedExtensionId: 'ext-1' })
    ;(manager.getExtension as Mock).mockReturnValue({ ws: extWs })

    const req = makeMsg()
    relayFrontendToExtension('fe-1', req)

    const resp = makeMsg({ replyTo: req.id })
    expect(relayExtensionResponseToFrontend(resp)).toBe(true)
    // Duplicate response
    expect(relayExtensionResponseToFrontend(resp)).toBe(false)
  })
})

describe('broadcastExtensionEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends git status events only to frontends that requested git status', () => {
    const { ws: ws1, sent: sent1 } = createMockWs()
    const { ws: ws2, sent: sent2 } = createMockWs()
    const { ws: ws3, sent: sent3 } = createMockWs()

    ;(manager.getFrontendsForExtension as Mock).mockReturnValue([
      { ws: ws1, selectedExtensionId: 'ext-1', desiredWatchSet: [{ topic: 'git.status', scope: 'workspace' }] },
      { ws: ws2, selectedExtensionId: 'ext-1', desiredWatchSet: [] },
      { ws: ws3, selectedExtensionId: 'ext-1', desiredWatchSet: [{ topic: 'file.content', path: 'src/a.ts' }] },
    ])

    const event = makeMsg({ type: 'git.statusChanged' })
    broadcastExtensionEvent('ext-1', event)

    expect(sent1).toHaveLength(1)
    expect(sent2).toHaveLength(0)
    expect(sent3).toHaveLength(0)
    expect(JSON.parse(sent1[0])).toMatchObject({ id: event.id, type: event.type })
  })

  it('sends nothing when no frontends are watching', () => {
    ;(manager.getFrontendsForExtension as Mock).mockReturnValue([])

    // Should not throw
    expect(() => broadcastExtensionEvent('ext-1', makeMsg())).not.toThrow()
  })

  it('sends file content events only to frontends that requested the same path', () => {
    const { ws: ws1, sent: sent1 } = createMockWs()
    const { ws: ws2, sent: sent2 } = createMockWs()

    ;(manager.getFrontendsForExtension as Mock).mockReturnValue([
      { ws: ws1, selectedExtensionId: 'ext-1', desiredWatchSet: [{ topic: 'file.content', path: 'src/a.ts' }] },
      { ws: ws2, selectedExtensionId: 'ext-1', desiredWatchSet: [{ topic: 'file.content', path: 'src/b.ts' }] },
    ])

    const event = makeMsg({ type: 'file.contentChanged', payload: { path: 'src/a.ts' } })
    broadcastExtensionEvent('ext-1', event)

    expect(sent1).toHaveLength(1)
    expect(sent2).toHaveLength(0)
  })

  it('still broadcasts non-watch-controlled events to all frontends on the extension', () => {
    const { ws: ws1, sent: sent1 } = createMockWs()
    const { ws: ws2, sent: sent2 } = createMockWs()

    ;(manager.getFrontendsForExtension as Mock).mockReturnValue([
      { ws: ws1, selectedExtensionId: 'ext-1', desiredWatchSet: [] },
      { ws: ws2, selectedExtensionId: 'ext-1', desiredWatchSet: [] },
    ])

    const event = makeMsg({ type: 'file.treeChanged' })
    broadcastExtensionEvent('ext-1', event)

    expect(sent1).toHaveLength(1)
    expect(sent2).toHaveLength(1)
  })
})

describe('concurrent requests', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('two requests with different IDs both route correctly to their respective frontends', () => {
    const { ws: feWs1, sent: feSent1 } = createMockWs()
    const { ws: feWs2, sent: feSent2 } = createMockWs()
    const { ws: extWs } = createMockWs()

    // Both frontends connected to ext-1
    ;(manager.getExtension as Mock).mockReturnValue({ ws: extWs })

    ;(manager.getFrontend as Mock).mockImplementation((id: string) => {
      if (id === 'fe-1') return { ws: feWs1, selectedExtensionId: 'ext-1' }
      if (id === 'fe-2') return { ws: feWs2, selectedExtensionId: 'ext-1' }
      return undefined
    })

    const req1 = makeMsg({ id: 'req-concurrent-1' })
    const req2 = makeMsg({ id: 'req-concurrent-2' })

    relayFrontendToExtension('fe-1', req1)
    relayFrontendToExtension('fe-2', req2)

    // Respond to req2 first
    const resp2 = makeMsg({ id: 'resp-concurrent-2', replyTo: req2.id })
    expect(relayExtensionResponseToFrontend(resp2)).toBe(true)

    expect(feSent2).toHaveLength(1)
    expect(feSent1).toHaveLength(0)

    // Now respond to req1
    const resp1 = makeMsg({ id: 'resp-concurrent-1', replyTo: req1.id })
    expect(relayExtensionResponseToFrontend(resp1)).toBe(true)

    expect(feSent1).toHaveLength(1)
  })
})
