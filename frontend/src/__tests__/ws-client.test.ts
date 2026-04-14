import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ---------------------------------------------------------------------------
// MockWebSocket — replaces the browser WebSocket in jsdom
// ---------------------------------------------------------------------------

class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = MockWebSocket.CONNECTING
  onopen: ((ev: Event) => void) | null = null
  onclose: ((ev: CloseEvent) => void) | null = null
  onmessage: ((ev: MessageEvent) => void) | null = null
  onerror: ((ev: Event) => void) | null = null
  sent: string[] = []

  static instances: MockWebSocket[] = []

  constructor(public url: string) {
    MockWebSocket.instances.push(this)
    // Simulate async connection
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN
      this.onopen?.(new Event('open'))
    }, 0)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({ code: 1000, reason: '' } as CloseEvent)
  }

  /** Helper: simulate an incoming message from the server. */
  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent)
  }

  /** Helper: simulate a server-side close (triggers reconnect logic). */
  simulateClose(code = 1006) {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({ code, reason: '' } as CloseEvent)
  }
}

vi.stubGlobal('WebSocket', MockWebSocket)

// ---------------------------------------------------------------------------
// Import the singleton AFTER stubbing WebSocket so the module picks it up.
// Because it is a singleton we reset its internal state in beforeEach instead
// of re-importing.
// ---------------------------------------------------------------------------

// eslint-disable-next-line import/first
import { wsClient } from '../services/ws-client.js'

// Access private fields via casting to any for test purposes
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const client = wsClient as any

function resetClient() {
  if (client.visibilityHandler) {
    document.removeEventListener('visibilitychange', client.visibilityHandler)
  }
  if (client.pageShowHandler) {
    window.removeEventListener('pageshow', client.pageShowHandler)
  }
  // Hard-reset all internal state so tests are independent
  client.ws = null
  client.url = ''
  client.listeners = new Map()
  client.stateListeners = new Set()
  client.state = 'disconnected'
  client.reconnectDelay = 1000
  client.maxReconnectDelay = 30000
  client.shouldReconnect = true
  client.pendingRequests = new Map()
  client.visibilityHandler = null
  client.pageShowHandler = null
  MockWebSocket.instances = []
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WsClientService', () => {
  beforeEach(() => {
    resetClient()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  // ── connect ──────────────────────────────────────────────────────────────

  describe('connect', () => {
    it('should create WebSocket with the correct URL', () => {
      wsClient.connect('ws://localhost:4800')
      expect(MockWebSocket.instances).toHaveLength(1)
      expect(MockWebSocket.instances[0].url).toBe('ws://localhost:4800')
    })

    it('state should be "connecting" immediately after connect()', () => {
      wsClient.connect('ws://localhost:4800')
      expect(wsClient.getState()).toBe('connecting')
    })

    it('state should become "connected" once the socket opens', async () => {
      wsClient.connect('ws://localhost:4800')
      // Flush the setTimeout(0) that fires onopen
      await vi.runAllTimersAsync()
      expect(wsClient.getState()).toBe('connected')
    })
  })

  // ── disconnect ───────────────────────────────────────────────────────────

  describe('disconnect', () => {
    it('should close the WebSocket and state becomes "disconnected"', async () => {
      wsClient.connect('ws://localhost:4800')
      await vi.runAllTimersAsync() // become connected

      wsClient.disconnect()
      expect(wsClient.getState()).toBe('disconnected')
    })

    it('should not reconnect after explicit disconnect', async () => {
      wsClient.connect('ws://localhost:4800')
      await vi.runAllTimersAsync()

      wsClient.disconnect()
      // Advance timers well past any reconnect delay
      await vi.advanceTimersByTimeAsync(10000)

      // Only one WebSocket should ever have been created
      expect(MockWebSocket.instances).toHaveLength(1)
    })
  })

  // ── send ─────────────────────────────────────────────────────────────────

  describe('send', () => {
    it('should JSON-stringify a WsMessage with type, id, payload, and timestamp', async () => {
      wsClient.connect('ws://localhost:4800')
      await vi.runAllTimersAsync()

      const socket = MockWebSocket.instances[0]
      wsClient.send('file.tree', { path: '/src' })

      expect(socket.sent).toHaveLength(1)
      const msg = JSON.parse(socket.sent[0])
      expect(msg.type).toBe('file.tree')
      expect(typeof msg.id).toBe('string')
      expect(msg.payload).toEqual({ path: '/src' })
      expect(typeof msg.timestamp).toBe('number')
    })

    it('should return the message id', async () => {
      wsClient.connect('ws://localhost:4800')
      await vi.runAllTimersAsync()

      const id = wsClient.send('ping', {})
      expect(typeof id).toBe('string')
      expect(id.length).toBeGreaterThan(0)
    })

    it('should include replyTo when provided', async () => {
      wsClient.connect('ws://localhost:4800')
      await vi.runAllTimersAsync()

      const socket = MockWebSocket.instances[0]
      wsClient.send('reply.msg', {}, 'original-id-123')

      const msg = JSON.parse(socket.sent[0])
      expect(msg.replyTo).toBe('original-id-123')
    })

    it('should not throw when socket is not yet open', () => {
      wsClient.connect('ws://localhost:4800')
      // readyState is still CONNECTING — send should be a no-op
      expect(() => wsClient.send('ping', {})).not.toThrow()
    })
  })

  // ── request ──────────────────────────────────────────────────────────────

  describe('request', () => {
    it('should send a message and resolve when a reply arrives', async () => {
      wsClient.connect('ws://localhost:4800')
      await vi.runAllTimersAsync()

      const socket = MockWebSocket.instances[0]
      const requestPromise = wsClient.request<{ path: string }, { nodes: [] }>(
        'file.tree',
        { path: '/src' },
      )

      // Extract the sent message id to use as replyTo
      const sentMsg = JSON.parse(socket.sent[0])
      const replyMsg = {
        type: 'file.tree.result',
        id: 'reply-id-1',
        replyTo: sentMsg.id,
        payload: { nodes: [] },
        timestamp: Date.now(),
      }
      socket.simulateMessage(replyMsg)

      const result = await requestPromise
      expect(result.payload).toEqual({ nodes: [] })
      expect(result.replyTo).toBe(sentMsg.id)
    })

    it('should reject immediately when socket is not connected', async () => {
      // Do not connect — socket is null
      await expect(wsClient.request('file.tree', {})).rejects.toThrow(
        'WebSocket is not connected',
      )
    })
  })

  // ── request timeout ───────────────────────────────────────────────────────

  describe('request timeout', () => {
    it('should reject after the timeout period elapses', async () => {
      wsClient.connect('ws://localhost:4800')
      await vi.runAllTimersAsync()

      // Wrap the assertion so the promise is always awaited (prevents
      // unhandled rejection warnings when fake timers fire the rejection).
      const rejection = expect(
        wsClient.request('file.tree', {}, 5000),
      ).rejects.toThrow('Request timed out: file.tree')

      // Advance past the timeout without sending a reply
      await vi.advanceTimersByTimeAsync(5001)

      await rejection
    })
  })

  // ── subscribe ─────────────────────────────────────────────────────────────

  describe('subscribe', () => {
    it('should call the listener when a message of the matching type arrives', async () => {
      wsClient.connect('ws://localhost:4800')
      await vi.runAllTimersAsync()

      const socket = MockWebSocket.instances[0]
      const listener = vi.fn()
      wsClient.subscribe('file.treeChanged', listener)

      socket.simulateMessage({
        type: 'file.treeChanged',
        id: 'msg-1',
        payload: { changes: [] },
        timestamp: Date.now(),
      })

      expect(listener).toHaveBeenCalledOnce()
      expect(listener.mock.calls[0][0].type).toBe('file.treeChanged')
    })

    it('should NOT call the listener for a different message type', async () => {
      wsClient.connect('ws://localhost:4800')
      await vi.runAllTimersAsync()

      const socket = MockWebSocket.instances[0]
      const listener = vi.fn()
      wsClient.subscribe('file.treeChanged', listener)

      socket.simulateMessage({
        type: 'git.statusChanged',
        id: 'msg-2',
        payload: {},
        timestamp: Date.now(),
      })

      expect(listener).not.toHaveBeenCalled()
    })
  })

  // ── unsubscribe ───────────────────────────────────────────────────────────

  describe('unsubscribe', () => {
    it('returned function should remove the listener', async () => {
      wsClient.connect('ws://localhost:4800')
      await vi.runAllTimersAsync()

      const socket = MockWebSocket.instances[0]
      const listener = vi.fn()
      const unsubscribe = wsClient.subscribe('file.treeChanged', listener)

      unsubscribe()

      socket.simulateMessage({
        type: 'file.treeChanged',
        id: 'msg-3',
        payload: { changes: [] },
        timestamp: Date.now(),
      })

      expect(listener).not.toHaveBeenCalled()
    })
  })

  // ── reconnect ─────────────────────────────────────────────────────────────

  describe('reconnect', () => {
    it('should create a new WebSocket after the server closes the connection', async () => {
      wsClient.connect('ws://localhost:4800')
      await vi.runAllTimersAsync() // become connected

      const firstSocket = MockWebSocket.instances[0]
      firstSocket.simulateClose()

      // Advance past the initial 1 s reconnect delay
      await vi.advanceTimersByTimeAsync(1001)

      // A second socket should have been created
      expect(MockWebSocket.instances).toHaveLength(2)
      expect(MockWebSocket.instances[1].url).toBe('ws://localhost:4800')
    })

    it('state should become "reconnecting" after the socket is closed unexpectedly', async () => {
      wsClient.connect('ws://localhost:4800')
      await vi.runAllTimersAsync()

      const socket = MockWebSocket.instances[0]
      socket.simulateClose()

      expect(wsClient.getState()).toBe('reconnecting')
    })

    it('should reconnect on pageshow when Safari restores a dead session', async () => {
      wsClient.connect('ws://localhost:4800')
      await vi.runAllTimersAsync()

      const firstSocket = MockWebSocket.instances[0]
      firstSocket.readyState = MockWebSocket.CLOSED
      client.ws = firstSocket
      client.state = 'disconnected'

      window.dispatchEvent(new Event('pageshow'))
      await vi.runAllTimersAsync()

      expect(MockWebSocket.instances).toHaveLength(2)
      expect(MockWebSocket.instances[1].url).toBe('ws://localhost:4800')
      expect(wsClient.getState()).toBe('connected')
    })
  })

  // ── reconnect backoff ─────────────────────────────────────────────────────

  describe('reconnect backoff', () => {
    it('reconnect delay should double on each failure (1s → 2s → 4s) without successful open', async () => {
      // Use a MockWebSocket variant that never fires onopen so the delay is
      // never reset to 1000.  We override the global for this test only.
      class NeverOpenSocket {
        static CONNECTING = 0
        static OPEN = 1
        static CLOSING = 2
        static CLOSED = 3

        readyState = NeverOpenSocket.CONNECTING
        onopen: ((ev: Event) => void) | null = null
        onclose: ((ev: CloseEvent) => void) | null = null
        onmessage: ((ev: MessageEvent) => void) | null = null
        onerror: ((ev: Event) => void) | null = null
        sent: string[] = []

        constructor(public url: string) {
          MockWebSocket.instances.push(this as unknown as MockWebSocket)
          // Intentionally does NOT schedule onopen — connection never succeeds.
        }

        send(data: string) { this.sent.push(data) }

        close() {
          this.readyState = NeverOpenSocket.CLOSED
          this.onclose?.({ code: 1000, reason: '' } as CloseEvent)
        }

        simulateClose(code = 1006) {
          this.readyState = NeverOpenSocket.CLOSED
          this.onclose?.({ code, reason: '' } as CloseEvent)
        }
      }

      vi.stubGlobal('WebSocket', NeverOpenSocket)

      try {
        // connect() → openSocket() → new NeverOpenSocket → reconnectDelay stays 1000
        wsClient.connect('ws://localhost:4800')
        expect(MockWebSocket.instances).toHaveLength(1)

        // First close: reconnect() uses delay=1000, then sets it to 2000
        MockWebSocket.instances[0].simulateClose()
        expect(client.reconnectDelay).toBe(2000)

        // Advance 1 s → second socket created (reconnect timer fires)
        await vi.advanceTimersByTimeAsync(1001)
        expect(MockWebSocket.instances).toHaveLength(2)

        // Second close: reconnect() uses delay=2000, then sets it to 4000
        MockWebSocket.instances[1].simulateClose()
        expect(client.reconnectDelay).toBe(4000)

        // Advance 2 s → third socket created
        await vi.advanceTimersByTimeAsync(2001)
        expect(MockWebSocket.instances).toHaveLength(3)

        // Third close: reconnect() uses delay=4000, then sets it to 8000
        MockWebSocket.instances[2].simulateClose()
        expect(client.reconnectDelay).toBe(8000)
      } finally {
        // Restore the original MockWebSocket so other tests are unaffected
        vi.stubGlobal('WebSocket', MockWebSocket)
      }
    })

    it('reconnect delay should not exceed maxReconnectDelay (30 s)', async () => {
      // Manually pre-set the delay near the cap
      client.reconnectDelay = 16000

      wsClient.connect('ws://localhost:4800')
      await vi.runAllTimersAsync()

      // Reset reconnectDelay after connect() resets it to 1000
      client.reconnectDelay = 16000

      MockWebSocket.instances[0].simulateClose()
      // 16000 * 2 = 32000 → capped at 30000
      expect(client.reconnectDelay).toBe(30000)
    })
  })

  // ── onStateChange ─────────────────────────────────────────────────────────

  describe('onStateChange', () => {
    it('should notify all state listeners on each state transition', async () => {
      const stateHistory: string[] = []
      wsClient.onStateChange((s) => stateHistory.push(s))

      wsClient.connect('ws://localhost:4800')
      // 'connecting' fired synchronously inside connect()
      expect(stateHistory).toContain('connecting')

      await vi.runAllTimersAsync()
      // 'connected' fired when onopen fires
      expect(stateHistory).toContain('connected')

      wsClient.disconnect()
      expect(stateHistory).toContain('disconnected')
    })

    it('returned function should remove the state listener', async () => {
      const listener = vi.fn()
      const unsub = wsClient.onStateChange(listener)
      unsub()

      wsClient.connect('ws://localhost:4800')
      await vi.runAllTimersAsync()

      expect(listener).not.toHaveBeenCalled()
    })
  })
})
