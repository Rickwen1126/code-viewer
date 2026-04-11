import type { WsMessage, ErrorPayload, WatchDescriptor } from '@code-viewer/shared'
import { manager } from './manager.js'

const DEBUG = process.env.CODE_VIEWER_DEBUG === 'true'
function dbg(...args: unknown[]): void { if (DEBUG) console.log('[relay]', ...args) }

interface PendingRequest {
  frontendId: string
  timeoutHandle: ReturnType<typeof setTimeout>
}

// Map from original message id → pending request info
const pendingRequests = new Map<string, PendingRequest>()

const RELAY_TIMEOUT_MS = 30000

function sendToWs(ws: { send: (data: string) => void }, msg: WsMessage): void {
  ws.send(JSON.stringify(msg))
}

function makeErrorMessage(replyTo: string, code: ErrorPayload['code'], message: string): WsMessage<ErrorPayload> {
  return {
    type: 'error',
    id: crypto.randomUUID(),
    replyTo,
    payload: { code, message },
    timestamp: Date.now(),
  }
}

function frontendWantsEvent(
  frontend: { desiredWatchSet?: WatchDescriptor[] },
  msg: WsMessage,
): boolean {
  const desiredWatchSet = frontend.desiredWatchSet ?? []

  if (msg.type === 'git.statusChanged') {
    return desiredWatchSet.some((watch) => watch.topic === 'git.status')
  }

  if (msg.type === 'file.contentChanged') {
    const path = (msg.payload as { path?: string } | undefined)?.path
    if (!path) return false
    return desiredWatchSet.some((watch) => watch.topic === 'file.content' && watch.path === path)
  }

  return true
}

/**
 * Forward a Frontend request to its selected Extension.
 * Registers a pending entry so the response can be routed back.
 */
export function relayFrontendToExtension(frontendId: string, msg: WsMessage): void {
  const frontend = manager.getFrontend(frontendId)
  if (!frontend) return

  const extensionId = frontend.selectedExtensionId
  if (!extensionId) {
    const fe = manager.getFrontend(frontendId)
    if (fe) {
      sendToWs(fe.ws, makeErrorMessage(msg.id, 'NOT_CONNECTED', 'No workspace selected'))
    }
    return
  }

  const extension = manager.getExtension(extensionId)
  if (!extension) {
    const fe = manager.getFrontend(frontendId)
    if (fe) {
      sendToWs(fe.ws, makeErrorMessage(msg.id, 'EXTENSION_OFFLINE', 'Extension is offline'))
    }
    return
  }

  // Register the pending request with a 30s timeout
  const timeoutHandle = setTimeout(() => {
    if (!pendingRequests.has(msg.id)) return // already handled by response
    pendingRequests.delete(msg.id)
    const fe = manager.getFrontend(frontendId)
    if (fe) {
      sendToWs(fe.ws, makeErrorMessage(msg.id, 'TIMEOUT', 'Extension did not respond in time'))
    }
  }, RELAY_TIMEOUT_MS)

  pendingRequests.set(msg.id, { frontendId, timeoutHandle })

  dbg(`${msg.type} ${msg.id} → extension (age: ${Date.now() - msg.timestamp}ms)`)
  sendToWs(extension.ws, msg)
}

/**
 * Forward an Extension response back to the Frontend that requested it.
 * Uses replyTo to look up the pending request.
 */
export function relayExtensionResponseToFrontend(msg: WsMessage): boolean {
  const replyTo = msg.replyTo
  if (!replyTo) return false

  const pending = pendingRequests.get(replyTo)
  if (!pending) return false

  clearTimeout(pending.timeoutHandle)
  pendingRequests.delete(replyTo)

  dbg(`${msg.type} ${msg.id} ← extension (round-trip: ${Date.now() - msg.timestamp}ms)`)

  const frontend = manager.getFrontend(pending.frontendId)
  if (frontend) {
    sendToWs(frontend.ws, msg)
  }

  return true
}

/**
 * Broadcast an Extension event to all Frontends watching that Extension.
 * Chat stream chunks are routed only to the requesting frontend.
 */
export function broadcastExtensionEvent(extensionId: string, msg: WsMessage): void {
  // Chat stream chunks should only go to the requesting frontend, not broadcast
  if (msg.type === 'chat.stream.chunk') {
    const innerReplyTo = (msg.payload as { replyTo?: string }).replyTo
    if (innerReplyTo) {
      const pending = pendingRequests.get(innerReplyTo)
      if (pending) {
        const frontend = manager.getFrontend(pending.frontendId)
        if (frontend) {
          sendToWs(frontend.ws, msg)
        }
        return
      }
    }
  }

  // Normal broadcast for all other events
  const frontends = manager.getFrontendsForExtension(extensionId)
  for (const frontend of frontends) {
    if (!frontendWantsEvent(frontend, msg)) continue
    sendToWs(frontend.ws, msg)
  }
}
