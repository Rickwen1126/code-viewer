import WebSocket from 'ws'
import type { WsMessage } from '@code-viewer/shared'

type MessageHandler = (message: WsMessage) => void

export function createMessage(type: string, payload: unknown, replyTo?: string): WsMessage {
  return {
    type,
    id: crypto.randomUUID(),
    replyTo,
    payload,
    timestamp: Date.now(),
  }
}

export class WsClient {
  private ws: WebSocket | null = null
  private url: string = ''
  private extensionId: string = ''
  private displayName: string = ''
  private reconnectDelay = 1000
  private maxReconnectDelay = 60000
  private shouldReconnect = true
  private messageHandler: MessageHandler | null = null
  private disconnectHandler: (() => void) | null = null
  private pendingResponses = new Map<string, (msg: WsMessage) => void>()

  connect(url: string, extensionId: string, displayName: string): void {
    this.url = url
    this.extensionId = extensionId
    this.displayName = displayName

    // Build URL with query params: ws://host/ws/extension?id=xxx&name=xxx
    const wsUrl = new URL('/ws/extension', url.replace(/^ws/, 'http'))
    wsUrl.searchParams.set('id', extensionId)
    wsUrl.searchParams.set('name', displayName)
    const fullUrl = wsUrl.toString().replace(/^http/, 'ws')

    this.ws = new WebSocket(fullUrl)

    this.ws.on('open', () => {
      console.log('[CodeViewer] Connected to backend')
      this.reconnectDelay = 1000
    })

    this.ws.on('message', (data: WebSocket.RawData) => {
      let message: WsMessage
      try {
        message = JSON.parse(data.toString()) as WsMessage
      } catch (err) {
        console.error('[CodeViewer] Failed to parse message:', err)
        return
      }

      // Route to pending response handler if this is a reply
      if (message.replyTo) {
        const handler = this.pendingResponses.get(message.replyTo)
        if (handler) {
          this.pendingResponses.delete(message.replyTo)
          handler(message)
          return
        }
      }

      // Route to general message handler
      if (this.messageHandler) {
        this.messageHandler(message)
      }
    })

    this.ws.on('close', () => {
      console.log('[CodeViewer] Disconnected from backend')
      this.disconnectHandler?.()
      this.reconnect()
    })

    this.ws.on('error', (err: Error) => {
      console.error('[CodeViewer] WebSocket error:', err.message)
    })
  }

  disconnect(): void {
    this.shouldReconnect = false
    this.ws?.close()
  }

  send(message: WsMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message))
    } else {
      console.warn('[CodeViewer] Cannot send message: not connected')
    }
  }

  sendRequest(message: WsMessage, timeout = 30000): Promise<WsMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingResponses.delete(message.id)
        reject(new Error(`[CodeViewer] Request timed out: ${message.type}`))
      }, timeout)

      this.pendingResponses.set(message.id, (response: WsMessage) => {
        clearTimeout(timer)
        resolve(response)
      })

      this.send(message)
    })
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler
  }

  onDisconnect(handler: () => void): void {
    this.disconnectHandler = handler
  }

  private reconnect(): void {
    if (!this.shouldReconnect) return
    setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay)
      this.connect(this.url, this.extensionId, this.displayName)
    }, this.reconnectDelay)
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }
}
