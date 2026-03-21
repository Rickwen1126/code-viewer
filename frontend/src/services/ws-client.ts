import type { WsMessage } from '@code-viewer/shared'

type MessageListener = (message: WsMessage) => void
type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting'

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

class WsClientService {
  private ws: WebSocket | null = null
  private url: string = ''
  private listeners = new Map<string, Set<MessageListener>>()
  private stateListeners = new Set<(state: ConnectionState) => void>()
  private state: ConnectionState = 'disconnected'
  private reconnectDelay = 1000
  private maxReconnectDelay = 30000
  private shouldReconnect = true
  private pendingRequests = new Map<
    string,
    {
      resolve: (msg: WsMessage) => void
      reject: (err: Error) => void
      timer: ReturnType<typeof setTimeout>
    }
  >()

  connect(url: string): void {
    // Idempotent guard: skip if already connecting/connected/reconnecting
    if (this.state === 'connecting' || this.state === 'connected' || this.state === 'reconnecting') return
    this.url = url
    this.shouldReconnect = true
    this.reconnectDelay = 1000
    this.openSocket()

    // Instant reconnect when page comes back to foreground (Safari kills WS in background)
    this.setupVisibilityReconnect()
  }

  private visibilityHandler: (() => void) | null = null

  private setupVisibilityReconnect(): void {
    if (this.visibilityHandler) return
    this.visibilityHandler = () => {
      if (document.visibilityState === 'visible' && this.shouldReconnect && this.state !== 'connected' && this.state !== 'connecting') {
        this.reconnectDelay = 1000
        this.openSocket()
      }
    }
    document.addEventListener('visibilitychange', this.visibilityHandler)
  }

  disconnect(): void {
    this.shouldReconnect = false
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.drainPendingRequests('Disconnected')
    this.setState('disconnected')
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
      } else {
        clearTimeout(timer)
        this.pendingRequests.delete(id)
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

  private openSocket(): void {
    this.setState('connecting')

    try {
      this.ws = new WebSocket(this.url)
    } catch {
      this.reconnect()
      return
    }

    this.ws.onopen = () => {
      this.reconnectDelay = 1000
      this.setState('connected')
    }

    this.ws.onclose = () => {
      this.ws = null
      this.drainPendingRequests('WebSocket connection closed')
      if (this.shouldReconnect) {
        this.reconnect()
      } else {
        this.setState('disconnected')
      }
    }

    this.ws.onerror = () => {
      // onclose will fire after onerror, so no extra handling needed
    }

    this.ws.onmessage = (event: MessageEvent) => {
      this.handleMessage(event)
    }
  }

  private reconnect(): void {
    this.setState('reconnecting')

    setTimeout(() => {
      if (this.shouldReconnect) {
        this.openSocket()
      }
    }, this.reconnectDelay)

    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay)
  }

  private handleMessage(event: MessageEvent): void {
    let message: WsMessage
    try {
      message = JSON.parse(event.data as string) as WsMessage
    } catch {
      console.error('Failed to parse WebSocket message', event.data)
      return
    }

    // Resolve pending request if this is a reply
    if (message.replyTo) {
      const pending = this.pendingRequests.get(message.replyTo)
      if (pending) {
        clearTimeout(pending.timer)
        this.pendingRequests.delete(message.replyTo)
        pending.resolve(message)
        return
      }
    }

    // Dispatch to type listeners
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

  private setState(state: ConnectionState): void {
    if (this.state === state) return
    this.state = state
    this.stateListeners.forEach((listener) => listener(state))
  }
}

export const wsClient = new WsClientService()
export type { ConnectionState }
