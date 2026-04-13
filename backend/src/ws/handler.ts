import type { UpgradeWebSocket } from 'hono/ws'
import type {
  WsMessage,
  WorkspaceRegisterPayload,
  SelectWorkspacePayload,
  SelectWorkspaceResultPayload,
  ListWorkspacesResultPayload,
  ConnectionWelcomePayload,
  ExtensionConnectedPayload,
  ExtensionDisconnectedPayload,
  FileTreeNode,
  WatchSyncPayload,
  WatchSyncResultPayload,
  WatchSetPayload,
} from '@code-viewer/shared'
import {
  MSG_CONNECTION_WELCOME,
  MSG_CONNECTION_LIST_WORKSPACES,
  MSG_CONNECTION_LIST_WORKSPACES_RESULT,
  MSG_CONNECTION_SELECT_WORKSPACE,
  MSG_CONNECTION_SELECT_WORKSPACE_RESULT,
  MSG_CONNECTION_EXTENSION_CONNECTED,
  MSG_CONNECTION_EXTENSION_DISCONNECTED,
  MSG_WORKSPACE_REGISTER,
  MSG_WORKSPACE_REGISTER_RESULT,
  MSG_WATCH_SYNC,
  MSG_WATCH_SYNC_RESULT,
  MSG_WATCH_SET,
} from '@code-viewer/shared'
import { manager } from './manager.js'
import {
  relayFrontendToExtension,
  relayExtensionResponseToFrontend,
  broadcastExtensionEvent,
} from './relay.js'
import { cache } from '../cache/session.js'

const WS_SECRET = process.env.CODE_VIEWER_SECRET ?? ''
const DEBUG = process.env.CODE_VIEWER_DEBUG === 'true'
function dbg(...args: unknown[]): void { if (DEBUG) console.log('[handler]', ...args) }

// Accept any UpgradeWebSocket compatible function
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UpgradeWsFn = UpgradeWebSocket<any, any>

function makeMessage<T>(type: string, payload: T, replyTo?: string): WsMessage<T> {
  return {
    type,
    id: crypto.randomUUID(),
    ...(replyTo !== undefined ? { replyTo } : {}),
    payload,
    timestamp: Date.now(),
  }
}

function sendJson(ws: { send: (data: string) => void }, msg: WsMessage): void {
  ws.send(JSON.stringify(msg))
}

function syncEffectiveWatchSet(extensionId: string | null | undefined): void {
  if (!extensionId) return
  const extension = manager.getExtension(extensionId)
  if (!extension) return
  const watches = manager.getEffectiveWatchSet(extensionId)
  dbg('syncEffectiveWatchSet', { extensionId, watches })

  sendJson(
    extension.ws,
    makeMessage<WatchSetPayload>(MSG_WATCH_SET, {
      watches,
    }),
  )
}

// Extension-initiated events have types that end with ".result", "Changed", or "chunk"
function isExtensionResponse(type: string): boolean {
  return type.endsWith('.result') || type.endsWith('Changed') || type.endsWith('Chunk')
}

export function createExtensionHandler(upgradeWebSocket: UpgradeWsFn) {
  return upgradeWebSocket((c) => {
    const url = new URL(c.req.url)
    const extensionId = url.searchParams.get('id') ?? crypto.randomUUID()
    const name = url.searchParams.get('name') ?? 'Unknown Workspace'

    return {
      onOpen(_evt: Event, ws: { send: (data: string) => void; close: (code: number, reason: string) => void }) {
        if (WS_SECRET) {
          const provided = url.searchParams.get('secret')
          if (provided !== WS_SECRET) {
            ws.close(1008, 'Unauthorized')
            console.log(`Rejected unauthorized extension connection`)
            return
          }
        }

        manager.addExtension(extensionId, ws as never, {
          extensionId,
          workspaceKey: extensionId,
          name,
          rootPath: '',
          gitBranch: null,
          vscodeVersion: 'unknown',
          extensionVersion: 'unknown',
        })

        sendJson(ws, makeMessage<ConnectionWelcomePayload>(MSG_CONNECTION_WELCOME, {
          backendVersion: '0.0.1',
        }))

        console.log(`Extension connected: ${extensionId} (${name})`)
      },

      onMessage(evt: { data: unknown }, ws: { send: (data: string) => void }) {
        let msg: WsMessage
        try {
          msg = JSON.parse(String(evt.data)) as WsMessage
        } catch {
          console.error(`Extension ${extensionId}: failed to parse message`)
          return
        }

        // Handle workspace.register locally
        if (msg.type === MSG_WORKSPACE_REGISTER) {
          const payload = msg.payload as WorkspaceRegisterPayload
          const entry = manager.getExtension(extensionId)
          if (entry) {
            const workspaceKey = manager.getOrCreateWorkspaceKey(payload.rootPath)
            entry.workspace = {
              extensionId,
              workspaceKey,
              name: payload.name,
              rootPath: payload.rootPath,
              gitBranch: payload.gitBranch,
              vscodeVersion: payload.vscodeVersion,
              extensionVersion: payload.extensionVersion ?? 'unknown',
            }
          }

          sendJson(ws, makeMessage(MSG_WORKSPACE_REGISTER_RESULT, { success: true }, msg.id))
          console.log(`Extension ${extensionId} registered workspace: ${payload.name} at ${payload.rootPath}`)

          // Broadcast extensionConnected to ALL frontends so workspace list updates
          const connectMsg = makeMessage<ExtensionConnectedPayload>(
            MSG_CONNECTION_EXTENSION_CONNECTED,
            {
              extensionId,
              workspaceKey: entry?.workspace.workspaceKey ?? manager.getOrCreateWorkspaceKey(payload.rootPath),
              displayName: payload.name,
              rootPath: payload.rootPath,
              extensionVersion: payload.extensionVersion ?? 'unknown',
            },
          )
          for (const [, frontend] of manager.frontends) {
            sendJson(frontend.ws, connectMsg)
          }

          dbg('workspace.register', { extensionId, workspace: payload.name, rootPath: payload.rootPath })
          syncEffectiveWatchSet(extensionId)
          return
        }

        // Update heartbeat on any message
        manager.updateHeartbeat(extensionId)

        // Route responses back to the requesting frontend
        if (msg.replyTo !== undefined && relayExtensionResponseToFrontend(msg)) {
          // Also update cache for file tree results
          if (msg.type === 'file.tree.result') {
            const payload = msg.payload as { nodes?: unknown[] }
            if (Array.isArray(payload.nodes)) {
              cache.setFileTree(extensionId, payload.nodes as FileTreeNode[])
            }
          }
          return
        }

        // Extension-initiated events → broadcast to all watching frontends
        if (isExtensionResponse(msg.type)) {
          if (msg.type === 'file.treeChanged') {
            cache.invalidateExtension(extensionId)
          }
          broadcastExtensionEvent(extensionId, msg)
          return
        }

        console.warn(`Extension ${extensionId}: unhandled message type "${msg.type}"`)
      },

      onClose(_evt: Event, _ws: { send: (data: string) => void }) {
        manager.removeExtension(extensionId)
        cache.invalidateExtension(extensionId)

        const disconnectMsg = makeMessage<ExtensionDisconnectedPayload>(
          MSG_CONNECTION_EXTENSION_DISCONNECTED,
          { extensionId, reason: 'closed' },
        )

        for (const [, frontend] of manager.frontends) {
          if (frontend.selectedExtensionId === extensionId) {
            sendJson(frontend.ws, disconnectMsg)
          }
        }

        console.log(`Extension disconnected: ${extensionId}`)
      },
    }
  })
}

export function createFrontendHandler(upgradeWebSocket: UpgradeWsFn) {
  return upgradeWebSocket((c) => {
    const frontendId = crypto.randomUUID()
    const frontendUrl = new URL(c.req.url, 'http://localhost')

    return {
      onOpen(_evt: Event, ws: { send: (data: string) => void; close: (code: number, reason: string) => void }) {
        if (WS_SECRET) {
          const provided = frontendUrl.searchParams.get('secret')
          if (provided !== WS_SECRET) {
            ws.close(1008, 'Unauthorized')
            console.log(`Rejected unauthorized frontend connection`)
            return
          }
        }

        manager.addFrontend(frontendId, ws as never)

        sendJson(ws, makeMessage<ConnectionWelcomePayload>(MSG_CONNECTION_WELCOME, {
          backendVersion: '0.0.1',
        }))

        console.log(`Frontend connected: ${frontendId}`)
      },

      onMessage(evt: { data: unknown }, ws: { send: (data: string) => void }) {
        let msg: WsMessage
        try {
          msg = JSON.parse(String(evt.data)) as WsMessage
        } catch {
          console.error(`Frontend ${frontendId}: failed to parse message`)
          return
        }

        // Handle connection.listWorkspaces locally
        if (msg.type === MSG_CONNECTION_LIST_WORKSPACES) {
          const workspaces = manager.listWorkspaces()
          sendJson(ws, makeMessage<ListWorkspacesResultPayload>(
            MSG_CONNECTION_LIST_WORKSPACES_RESULT,
            { workspaces },
            msg.id,
          ))
          return
        }

        // Handle connection.selectWorkspace locally
        if (msg.type === MSG_CONNECTION_SELECT_WORKSPACE) {
          const payload = msg.payload as SelectWorkspacePayload
          const previousExtensionId = manager.getFrontend(frontendId)?.selectedExtensionId ?? null
          const extension = manager.getExtension(payload.extensionId)

          if (!extension) {
            sendJson(ws, {
              type: 'error',
              id: crypto.randomUUID(),
              replyTo: msg.id,
              payload: { code: 'EXTENSION_OFFLINE', message: 'Extension not found' },
              timestamp: Date.now(),
            })
            return
          }

          manager.selectWorkspace(frontendId, payload.extensionId)
          if (previousExtensionId !== null && previousExtensionId !== payload.extensionId) {
            manager.clearFrontendDesiredWatchSet(frontendId)
          }
          dbg('selectWorkspace', { frontendId, previousExtensionId, nextExtensionId: payload.extensionId })

          sendJson(ws, makeMessage<SelectWorkspaceResultPayload>(
            MSG_CONNECTION_SELECT_WORKSPACE_RESULT,
            {
              workspace: {
                extensionId: extension.workspace.extensionId,
                workspaceKey: extension.workspace.workspaceKey,
                name: extension.workspace.name,
                rootPath: extension.workspace.rootPath,
                gitBranch: extension.workspace.gitBranch,
                vscodeVersion: extension.workspace.vscodeVersion,
                extensionVersion: extension.workspace.extensionVersion ?? 'unknown',
              },
            },
            msg.id,
          ))

          if (previousExtensionId !== null && previousExtensionId !== payload.extensionId) {
            syncEffectiveWatchSet(previousExtensionId)
          }
          syncEffectiveWatchSet(payload.extensionId)
          return
        }

        if (msg.type === MSG_WATCH_SYNC) {
          const payload = msg.payload as WatchSyncPayload
          manager.setFrontendDesiredWatchSet(frontendId, Array.isArray(payload.watches) ? payload.watches : [])
          dbg('watch.sync', {
            frontendId,
            selectedExtensionId: manager.getFrontend(frontendId)?.selectedExtensionId ?? null,
            watches: Array.isArray(payload.watches) ? payload.watches : [],
          })

          sendJson(ws, makeMessage<WatchSyncResultPayload>(
            MSG_WATCH_SYNC_RESULT,
            { watches: Array.isArray(payload.watches) ? payload.watches : [] },
            msg.id,
          ))

          syncEffectiveWatchSet(manager.getFrontend(frontendId)?.selectedExtensionId)
          return
        }

        // All other messages → relay to the selected extension
        relayFrontendToExtension(frontendId, msg)
      },

      onClose(_evt: Event, _ws: { send: (data: string) => void }) {
        const selectedExtensionId = manager.getFrontend(frontendId)?.selectedExtensionId ?? null
        manager.removeFrontend(frontendId)
        syncEffectiveWatchSet(selectedExtensionId)
        console.log(`Frontend disconnected: ${frontendId}`)
      },
    }
  })
}
