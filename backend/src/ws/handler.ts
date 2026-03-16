import type { UpgradeWebSocket } from 'hono/ws'
import type {
  WsMessage,
  WorkspaceRegisterPayload,
  SelectWorkspacePayload,
  SelectWorkspaceResultPayload,
  ListWorkspacesResultPayload,
  ConnectionWelcomePayload,
  ExtensionDisconnectedPayload,
  FileTreeNode,
} from '@code-viewer/shared'
import {
  MSG_CONNECTION_WELCOME,
  MSG_CONNECTION_LIST_WORKSPACES,
  MSG_CONNECTION_LIST_WORKSPACES_RESULT,
  MSG_CONNECTION_SELECT_WORKSPACE,
  MSG_CONNECTION_SELECT_WORKSPACE_RESULT,
  MSG_CONNECTION_EXTENSION_DISCONNECTED,
  MSG_WORKSPACE_REGISTER,
  MSG_WORKSPACE_REGISTER_RESULT,
} from '@code-viewer/shared'
import { manager } from './manager.js'
import {
  relayFrontendToExtension,
  relayExtensionResponseToFrontend,
  broadcastExtensionEvent,
} from './relay.js'
import { cache } from '../cache/session.js'

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
      onOpen(_evt: Event, ws: { send: (data: string) => void }) {
        manager.addExtension(extensionId, ws as never, {
          extensionId,
          name,
          rootPath: '',
          gitBranch: null,
          vscodeVersion: 'unknown',
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
            entry.workspace = {
              extensionId,
              name: payload.name,
              rootPath: payload.rootPath,
              gitBranch: payload.gitBranch,
              vscodeVersion: payload.vscodeVersion,
            }
          }

          sendJson(ws, makeMessage(MSG_WORKSPACE_REGISTER_RESULT, { success: true }, msg.id))
          console.log(`Extension ${extensionId} registered workspace: ${payload.name} at ${payload.rootPath}`)
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
  return upgradeWebSocket((_c) => {
    const frontendId = crypto.randomUUID()

    return {
      onOpen(_evt: Event, ws: { send: (data: string) => void }) {
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

          sendJson(ws, makeMessage<SelectWorkspaceResultPayload>(
            MSG_CONNECTION_SELECT_WORKSPACE_RESULT,
            {
              workspace: {
                extensionId: extension.workspace.extensionId,
                name: extension.workspace.name,
                rootPath: extension.workspace.rootPath,
                gitBranch: extension.workspace.gitBranch,
                vscodeVersion: extension.workspace.vscodeVersion,
              },
            },
            msg.id,
          ))
          return
        }

        // All other messages → relay to the selected extension
        relayFrontendToExtension(frontendId, msg)
      },

      onClose(_evt: Event, _ws: { send: (data: string) => void }) {
        manager.removeFrontend(frontendId)
        console.log(`Frontend disconnected: ${frontendId}`)
      },
    }
  })
}
