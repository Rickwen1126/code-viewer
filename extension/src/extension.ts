import * as vscode from 'vscode'
import type { WsMessage } from '@code-viewer/shared'
import { WsClient, createMessage } from './ws/client'
import { handleFileTree, handleFileRead, startFileWatchers } from './providers/file-provider'
import { handleLspHover, handleLspDefinition, handleLspReferences, handleLspDocumentSymbol } from './providers/lsp-provider'
import { handleGitStatus, handleGitDiff, handleGitLog, handleGitCommitFiles, startGitWatchers } from './providers/git-provider'
import {
  handleChatListSessions,
  handleChatGetHistory,
  handleChatSend,
  handleChatListModels,
  handleReviewListPendingEdits,
  handleReviewGetEditDiff,
  handleReviewApproveEdit,
  handleReviewRejectEdit,
  handleReviewListToolRequests,
  handleReviewAcceptTool,
  handleReviewSkipTool,
} from './providers/copilot-provider'
import {
  handleTourList,
  handleTourGetSteps,
  handleTourCreate,
  handleTourAddStep,
  handleTourDeleteStep,
  handleTourFinalize,
  handleTourDelete,
  handleTourGetFileAtRef,
} from './providers/tour-provider'

let wsClient: WsClient | undefined
let currentExtensionVersion = 'unknown'

function isDebug(): boolean {
  return vscode.workspace.getConfiguration('codeViewer').get<boolean>('debug', false)
}
function dbg(...args: unknown[]): void {
  if (isDebug()) console.log('[CodeViewer]', ...args)
}

// Handler type: takes message + sendResponse, optionally the WsClient for streaming
type Handler = (msg: WsMessage, send: (m: WsMessage) => void, client?: WsClient) => Promise<void>

// Dispatch table: message type → handler function
const handlers: Record<string, Handler> = {
  'file.tree': handleFileTree,
  'file.read': handleFileRead,
  'lsp.hover': handleLspHover,
  'lsp.definition': handleLspDefinition,
  'lsp.references': handleLspReferences,
  'lsp.documentSymbol': handleLspDocumentSymbol,
  'git.status': handleGitStatus,
  'git.diff': handleGitDiff,
  'git.log': handleGitLog,
  'git.commitFiles': handleGitCommitFiles,
  'chat.listSessions': handleChatListSessions,
  'chat.getHistory': handleChatGetHistory,
  'chat.send': handleChatSend,
  'chat.listModels': handleChatListModels,
  'review.listPendingEdits': handleReviewListPendingEdits,
  'review.getEditDiff': handleReviewGetEditDiff,
  'review.approveEdit': handleReviewApproveEdit,
  'review.rejectEdit': handleReviewRejectEdit,
  'review.listToolRequests': handleReviewListToolRequests,
  'review.acceptTool': handleReviewAcceptTool,
  'review.skipTool': handleReviewSkipTool,
  'tour.list': handleTourList,
  'tour.getSteps': handleTourGetSteps,
  'tour.create': handleTourCreate,
  'tour.addStep': handleTourAddStep,
  'tour.deleteStep': handleTourDeleteStep,
  'tour.finalize': handleTourFinalize,
  'tour.delete': handleTourDelete,
  'tour.getFileAtRef': handleTourGetFileAtRef,
}

// T017: Message routing — dispatches incoming messages to providers
export function setupMessageRouting(client: WsClient): void {
  const sendResponse = (msg: WsMessage) => client.send(msg)

  client.onMessage((message) => {
    // Handle connection.welcome → send workspace.register
    if (message.type === 'connection.welcome') {
      const sendRegister = () => {
        const ws = {
          name: vscode.workspace.workspaceFolders?.[0]?.name ?? 'Unknown',
          rootPath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '',
          gitBranch: null as string | null,
          vscodeVersion: vscode.version,
          extensionVersion: currentExtensionVersion,
        }
        client.send(createMessage('workspace.register', ws))
      }

      // workspaceFolders may not be ready yet — wait if empty
      if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        sendRegister()
      } else {
        // Wait for workspace folder to become available, then register
        const disposable = vscode.workspace.onDidChangeWorkspaceFolders(() => {
          disposable.dispose()
          sendRegister()
        })
        // Fallback: register with Unknown after 3s if no folder appears
        setTimeout(() => { disposable.dispose(); sendRegister() }, 3000)
      }
      return
    }

    // Dispatch to handler with unified error fallback
    const handler = handlers[message.type]
    if (handler) {
      dbg('⇒', message.type, message.id.slice(0, 8))
      const start = Date.now()
      handler(message, (resp) => {
        dbg('⇐', resp.type, message.id.slice(0, 8), `${Date.now() - start}ms`)
        sendResponse(resp)
      }, client).catch((err) => {
        console.error(`[CodeViewer] ${message.type} error:`, err)
        sendResponse(
          createMessage(message.type + '.error', {
            code: 'INVALID_REQUEST',
            message: String(err),
          }, message.id),
        )
      })
    } else {
      console.log(`[CodeViewer] Unhandled message type: ${message.type}`)
    }
  })
}

export function activate(context: vscode.ExtensionContext) {
  wsClient = new WsClient()
  currentExtensionVersion = String(context.extension.packageJSON.version ?? 'unknown')

  // Generate extensionId: machineName-pid
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const extensionId = `${process.env.COMPUTERNAME ?? (require('os') as { hostname(): string }).hostname()}-${process.pid}`
  // Getter — workspaceFolders may not be ready at activation time (Extension Dev Host)
  const getDisplayName = () => vscode.workspace.workspaceFolders?.[0]?.name ?? 'Unknown'

  // Register commands
  const connectCmd = vscode.commands.registerCommand('codeViewer.connect', () => {
    const backendUrl = process.env.CODE_VIEWER_BACKEND_URL
      ?? vscode.workspace.getConfiguration('codeViewer').get<string>('backendUrl', 'ws://localhost:4800')
    wsClient!.connect(backendUrl, extensionId, getDisplayName())
    vscode.window.showInformationMessage('Code Viewer: Connecting to backend...')
  })

  const disconnectCmd = vscode.commands.registerCommand('codeViewer.disconnect', () => {
    wsClient!.disconnect()
    vscode.window.showInformationMessage('Code Viewer: Disconnected')
  })

  context.subscriptions.push(connectCmd, disconnectCmd)

  // Set up message routing (T017)
  setupMessageRouting(wsClient)

  // Start file watchers (T027)
  const sendEvent = (msg: WsMessage) => wsClient!.send(msg)
  const fileWatcherDisposables = startFileWatchers(sendEvent)
  context.subscriptions.push(...fileWatcherDisposables)

  // Start git watchers (T043)
  const gitWatcherDisposables = startGitWatchers(sendEvent)
  context.subscriptions.push(...gitWatcherDisposables)

  // Setting-driven connection: codeViewer.enabled controls whether to connect.
  // Default: false (zero interference). CLI or AI sets it to true in workspace settings.
  function handleEnabledChange() {
    const config = vscode.workspace.getConfiguration('codeViewer')
    const enabled = config.get<boolean>('enabled', false)
    const backendUrl = config.get<string>('backendUrl', 'ws://localhost:4800')

    if (enabled) {
      console.log('[CodeViewer] Enabled — connecting to', backendUrl)
      wsClient!.connect(backendUrl, extensionId, getDisplayName())
    } else {
      wsClient!.disconnect()
    }
  }

  // React to setting changes immediately (no reload needed)
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('codeViewer.enabled') || e.affectsConfiguration('codeViewer.backendUrl')) {
        handleEnabledChange()
      }
    })
  )

  // Check on activation
  handleEnabledChange()
}

export function deactivate() {
  wsClient?.disconnect()
}
