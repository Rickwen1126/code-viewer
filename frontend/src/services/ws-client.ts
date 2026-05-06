import type { WsMessage } from '@code-viewer/shared'

type MessageListener = (message: WsMessage) => void
type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting'

function isDebug(): boolean {
  try { return localStorage.getItem('code-viewer:debug') === 'true' } catch { return false }
}
function dbg(...args: unknown[]): void {
  if (isDebug()) console.log('[ws]', ...args)
}

// crypto.randomUUID() is only available in secure contexts (HTTPS or localhost).
// Fallback for HTTP on LAN (e.g. http://192.168.x.x)
export function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// --- State Machine ---

type TransitionEvent =
  | 'OPEN_SOCKET'
  | 'SOCKET_OPEN'
  | 'SOCKET_CLOSED'
  | 'DISCONNECT'

const TRANSITIONS: Record<ConnectionState, Partial<Record<TransitionEvent, ConnectionState>>> = {
  disconnected: { OPEN_SOCKET: 'connecting' },
  connecting: { SOCKET_OPEN: 'connected', SOCKET_CLOSED: 'reconnecting', DISCONNECT: 'disconnected' },
  connected: { OPEN_SOCKET: 'connecting', SOCKET_CLOSED: 'reconnecting', DISCONNECT: 'disconnected' },
  reconnecting: { OPEN_SOCKET: 'connecting', DISCONNECT: 'disconnected' },
}

// --- Service ---

class WsClientService {
  private ws: WebSocket | null = null
  private url: string = ''
  private epoch = 0
  private state: ConnectionState = 'disconnected'
  private intentionalClose = false

  // Timers
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private connectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectDelay = 1000
  private maxReconnectDelay = 30000
  private consecutiveFailures = 0
  private wsConnectTimeouts = 0

  // Session state (survives transport reconnects, cleared on intentional disconnect)
  private listeners = new Map<string, Set<MessageListener>>()
  private stateListeners = new Set<(state: ConnectionState) => void>()
  private pendingRequests = new Map<
    string,
    {
      resolve: (msg: WsMessage) => void
      reject: (err: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()

  // Visibility handlers
  private visibilityHandler: (() => void) | null = null
  private pageShowHandler: ((event: PageTransitionEvent) => void) | null = null
  private probing = false

  // --- Public API (unchanged) ---

  connect(url: string): void {
    if (this.state !== 'disconnected') return
    this.url = url
    this.intentionalClose = false
    this.reconnectDelay = 1000
    this.openSocket()
    this.setupVisibilityReconnect()
  }

  disconnect(): void {
    this.intentionalClose = true
    this.clearTimers()
    this.setConnection(null)
    this.drainPendingRequests('Disconnected')
    this.transition('DISCONNECT')
  }

  send<T>(type: string, payload: T, replyTo?: string): string {
    const id = generateId()
    const message: WsMessage<T> = {
      type,
      id,
      replyTo,
      payload,
      timestamp: Date.now(),
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
      dbg('→', type, id.slice(0, 8))
    } else {
      dbg('→ DROPPED (not connected)', type, id.slice(0, 8))
    }
    return id
  }

  request<TReq, TRes>(
    type: string,
    payload: TReq,
    timeout = 30000,
  ): Promise<WsMessage<TRes>> {
    return new Promise((resolve, reject) => {
      const id = generateId()
      const message: WsMessage<TReq> = {
        type,
        id,
        payload,
        timestamp: Date.now(),
      }

      const timer = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`Request timed out: ${type}`))
      }, timeout)

      this.pendingRequests.set(id, {
        resolve: resolve as (msg: WsMessage) => void,
        reject,
        timer,
      })

      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(message))
        dbg('⇒', type, id.slice(0, 8))
      } else {
        clearTimeout(timer)
        this.pendingRequests.delete(id)
        dbg('⇒ FAILED (not connected)', type, id.slice(0, 8))
        reject(new Error('WebSocket is not connected'))
      }
    })
  }

  subscribe(type: string, listener: MessageListener): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set())
    }
    this.listeners.get(type)!.add(listener)

    return () => {
      const set = this.listeners.get(type)
      if (set) {
        set.delete(listener)
        if (set.size === 0) {
          this.listeners.delete(type)
        }
      }
    }
  }

  onStateChange(listener: (state: ConnectionState) => void): () => void {
    this.stateListeners.add(listener)
    return () => {
      this.stateListeners.delete(listener)
    }
  }

  getState(): ConnectionState {
    return this.state
  }

  // --- Transport layer ---

  private setConnection(socket: WebSocket | null): void {
    if (this.ws) {
      this.ws.onopen = null
      this.ws.onclose = null
      this.ws.onerror = null
      this.ws.onmessage = null
      try { this.ws.close() } catch { /* ignore */ }
    }
    this.ws = socket
  }

  private openSocket(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (!this.transition('OPEN_SOCKET')) return

    this.epoch++
    const socketEpoch = this.epoch

    let socket: WebSocket
    try {
      socket = new WebSocket(this.url)
    } catch {
      this.scheduleReconnect()
      return
    }

    this.ws = socket

    this.connectTimer = setTimeout(() => {
      this.connectTimer = null
      if (this.epoch !== socketEpoch) return
      if (socket.readyState !== WebSocket.CONNECTING) return

      this.consecutiveFailures++
      this.wsConnectTimeouts++
      console.warn(`[ws] connect timeout (#${this.consecutiveFailures}, 5s stuck in CONNECTING) — forcing reconnect`)

      this.setConnection(null)
      this.drainPendingRequests('Connect timeout')

      if (this.wsConnectTimeouts >= 3) {
        try {
          const key = 'ws-recovery-ts'
          const lastReload = Number(sessionStorage.getItem(key) || '0')
          if (Date.now() - lastReload > 60000) {
            sessionStorage.setItem(key, String(Date.now()))
            console.warn('[ws] Safari WebSocket stuck — reloading page to recover')
            window.location.reload()
            return
          }
        } catch { /* sessionStorage may be unavailable */ }
      }

      this.transition('SOCKET_CLOSED')
      this.scheduleReconnect()
    }, 5000)

    socket.onopen = () => {
      if (this.epoch !== socketEpoch) {
        dbg(`onopen ignored (epoch ${socketEpoch} !== ${this.epoch})`)
        return
      }
      if (this.connectTimer !== null) { clearTimeout(this.connectTimer); this.connectTimer = null }
      if (this.consecutiveFailures > 0) {
        console.log(`[ws] connected after ${this.consecutiveFailures} failed attempt(s)`)
      }
      this.consecutiveFailures = 0
      this.wsConnectTimeouts = 0
      this.reconnectDelay = 1000
      this.transition('SOCKET_OPEN')
    }

    socket.onclose = () => {
      if (this.epoch !== socketEpoch) {
        dbg(`onclose ignored (epoch ${socketEpoch} !== ${this.epoch})`)
        return
      }
      if (this.connectTimer !== null) { clearTimeout(this.connectTimer); this.connectTimer = null }
      this.ws = null
      this.drainPendingRequests('WebSocket connection closed')

      if (this.intentionalClose) {
        this.transition('DISCONNECT')
      } else {
        this.transition('SOCKET_CLOSED')
        this.scheduleReconnect()
      }
    }

    socket.onerror = () => {
      // onclose will fire after onerror
    }

    socket.onmessage = (event: MessageEvent) => {
      if (this.epoch !== socketEpoch) return
      this.handleMessage(event)
    }
  }

  private scheduleReconnect(): void {
    if (this.intentionalClose) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.intentionalClose) return
      this.openSocket()
    }, this.reconnectDelay)

    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay)
  }

  private forceReconnect(reason: string): void {
    this.clearTimers()
    this.setConnection(null)
    this.drainPendingRequests(reason)
    this.reconnectDelay = 1000
    this.openSocket()
  }

  // --- Visibility handlers ---

  private setupVisibilityReconnect(): void {
    if (this.visibilityHandler) return
    this.visibilityHandler = () => {
      console.log(`[ws] visibilitychange: ${document.visibilityState}, ws=${this.ws?.readyState}, state=${this.state}`)
      if (document.visibilityState !== 'visible') return
      this.ensureActiveConnection('foreground')
    }
    this.pageShowHandler = (event) => {
      console.log(`[ws] pageshow: persisted=${event.persisted}, ws=${this.ws?.readyState}, state=${this.state}`)
      if (!this.shouldReconnectOnPageShow(event)) return
      this.ensureActiveConnection('pageshow')
    }
    document.addEventListener('visibilitychange', this.visibilityHandler)
    window.addEventListener('pageshow', this.pageShowHandler)
  }

  private ensureActiveConnection(reason: 'foreground' | 'pageshow'): void {
    if (this.intentionalClose) return

    if (this.ws && this.ws.readyState > WebSocket.OPEN) {
      console.warn(`[WS] Zombie connection detected on ${reason} (readyState=${this.ws.readyState}) — forcing reconnect`)
      this.forceReconnect('Connection lost in background')
      return
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.state === 'connected') {
      this.probeConnection(reason)
      return
    }

    if (this.state !== 'connected' && this.state !== 'connecting') {
      this.reconnectDelay = Math.min(this.reconnectDelay, 2000)
      this.openSocket()
    }
  }

  private probeConnection(reason: string): void {
    if (this.probing) return
    this.probing = true

    this.request<Record<string, never>, Record<string, never>>('ping', {}, 3000)
      .then(() => {
        dbg(`Ping OK on ${reason} — connection alive`)
      })
      .catch(() => {
        if (this.intentionalClose) return
        console.warn(`[WS] Ping failed on ${reason} — zombie socket, forcing reconnect`)
        this.forceReconnect('Connection lost in background')
      })
      .finally(() => {
        this.probing = false
      })
  }

  private shouldReconnectOnPageShow(event: PageTransitionEvent): boolean {
    if (event.persisted) return true
    try {
      const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
      return nav?.type === 'back_forward'
    } catch {
      return false
    }
  }

  // --- Session layer ---

  private handleMessage(event: MessageEvent): void {
    let message: WsMessage
    try {
      message = JSON.parse(event.data as string) as WsMessage
    } catch {
      console.error('Failed to parse WebSocket message', event.data)
      return
    }

    if (message.replyTo) {
      const pending = this.pendingRequests.get(message.replyTo)
      if (pending) {
        clearTimeout(pending.timer)
        this.pendingRequests.delete(message.replyTo)
        const rt = Date.now() - message.timestamp
        if (message.type === 'error' || message.type.endsWith('.error')) {
          const errPayload = message.payload as { code?: string; message?: string }
          dbg('⇐ ERROR', message.type, message.replyTo.slice(0, 8), `${rt}ms`, errPayload?.code, errPayload?.message)
          pending.reject(new Error(errPayload?.message ?? message.type))
        } else {
          dbg('⇐', message.type, message.replyTo.slice(0, 8), `${rt}ms`)
          pending.resolve(message)
        }
        return
      }
    }

    dbg('←', message.type, message.id.slice(0, 8))
    const set = this.listeners.get(message.type)
    if (set) {
      set.forEach((listener) => listener(message))
    }
  }

  private drainPendingRequests(reason: string): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer)
      pending.reject(new Error(reason))
    }
    this.pendingRequests.clear()
  }

  // --- Infrastructure ---

  private transition(event: TransitionEvent): boolean {
    const next = TRANSITIONS[this.state]?.[event]
    if (!next) {
      dbg(`transition ignored: ${this.state} + ${event}`)
      return false
    }
    const listenerCount = this.stateListeners.size
    console.log(`[ws] state: ${this.state} → ${next} (${listenerCount} listeners)`)
    this.state = next
    this.stateListeners.forEach((listener) => listener(next))
    return true
  }

  private clearTimers(): void {
    if (this.connectTimer !== null) { clearTimeout(this.connectTimer); this.connectTimer = null }
    if (this.reconnectTimer !== null) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null }
  }
}

export const wsClient = new WsClientService()
export type { ConnectionState }
