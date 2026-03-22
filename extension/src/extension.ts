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
import { handleTourList, handleTourGetSteps } from './providers/tour-provider'

let wsClient: WsClient | undefined

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
}

// T017: Message routing — dispatches incoming messages to providers
export function setupMessageRouting(client: WsClient): void {
  const sendResponse = (msg: WsMessage) => client.send(msg)

  client.onMessage((message) => {
    // Handle connection.welcome → send workspace.register
    if (message.type === 'connection.welcome') {
      const workspace = {
        name: vscode.workspace.workspaceFolders?.[0]?.name ?? 'Unknown',
        rootPath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '',
        gitBranch: null as string | null,
        vscodeVersion: vscode.version,
      }
      client.send(createMessage('workspace.register', workspace))
      return
    }

    // Dispatch to handler with unified error fallback
    const handler = handlers[message.type]
    if (handler) {
      handler(message, sendResponse, client).catch((err) => {
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

  // Generate extensionId: machineName-pid
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const extensionId = `${process.env.COMPUTERNAME ?? (require('os') as { hostname(): string }).hostname()}-${process.pid}`
  const displayName = vscode.workspace.workspaceFolders?.[0]?.name ?? 'Unknown'

  // Register commands
  const connectCmd = vscode.commands.registerCommand('codeViewer.connect', () => {
    const backendUrl = process.env.CODE_VIEWER_BACKEND_URL
      ?? vscode.workspace.getConfiguration('codeViewer').get<string>('backendUrl', 'ws://localhost:4800')
    wsClient!.connect(backendUrl, extensionId, displayName)
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

  // Auto-connect: probe backend health endpoint first.
  // If backend is running → connect. If not → stay silent (zero interference).
  const backendUrl = process.env.CODE_VIEWER_BACKEND_URL
    ?? vscode.workspace.getConfiguration('codeViewer').get<string>('backendUrl', 'ws://localhost:4800')
  // Parse WS URL to get host/port for health probe
  const urlMatch = backendUrl.match(/^wss?:\/\/([^:/]+)(?::(\d+))?/)
  const probeHost = urlMatch?.[1] ?? 'localhost'
  const probePort = parseInt(urlMatch?.[2] ?? '4800')

  // Non-blocking probe using http (fetch may not exist in all Extension Hosts)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const http = require('http') as typeof import('http')
  const req = http.get({ host: probeHost, port: probePort, path: '/health', timeout: 3000 }, (res) => {
    if (res.statusCode === 200) {
      console.log('[CodeViewer] Backend detected — auto-connecting')
      wsClient!.connect(backendUrl, extensionId, displayName)
    }
    res.resume() // consume response
  })
  req.on('error', () => { /* Backend not running — stay silent */ })
  req.on('timeout', () => { req.destroy() })
}

export function deactivate() {
  wsClient?.disconnect()
}
