import * as vscode from 'vscode'
import type { WsMessage } from '@code-viewer/shared'
import { WsClient, createMessage } from './ws/client'
import { handleFileTree, handleFileRead, startFileWatchers } from './providers/file-provider'
import { handleLspHover, handleLspDefinition, handleLspReferences, handleLspDocumentSymbol } from './providers/lsp-provider'
import { handleGitStatus, handleGitDiff, startGitWatchers } from './providers/git-provider'
import {
  handleChatListSessions,
  handleChatGetHistory,
  handleChatSend,
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

// T017: Message routing — dispatches incoming messages to providers
export function setupMessageRouting(client: WsClient): void {
  client.onMessage((message) => {
    // Handle connection.welcome → send workspace.register
    if (message.type === 'connection.welcome') {
      const workspace = {
        name: vscode.workspace.workspaceFolders?.[0]?.name ?? 'Unknown',
        rootPath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '',
        gitBranch: null as string | null, // will be filled by git provider later
        vscodeVersion: vscode.version,
      }
      client.send(createMessage('workspace.register', workspace))
      return
    }

    // Route by message type prefix to providers
    const sendResponse = (msg: WsMessage) => client.send(msg)

    if (message.type === 'file.tree') {
      handleFileTree(message, sendResponse).catch((err) =>
        console.error('[CodeViewer] handleFileTree error:', err),
      )
      return
    }

    if (message.type === 'file.read') {
      handleFileRead(message, sendResponse).catch((err) =>
        console.error('[CodeViewer] handleFileRead error:', err),
      )
      return
    }

    // lsp.*  → lspProvider (T036)
    if (message.type === 'lsp.hover') {
      handleLspHover(message, sendResponse).catch((err) =>
        console.error('[CodeViewer] handleLspHover error:', err),
      )
      return
    }

    if (message.type === 'lsp.definition') {
      handleLspDefinition(message, sendResponse).catch((err) =>
        console.error('[CodeViewer] handleLspDefinition error:', err),
      )
      return
    }

    if (message.type === 'lsp.references') {
      handleLspReferences(message, sendResponse).catch((err) =>
        console.error('[CodeViewer] handleLspReferences error:', err),
      )
      return
    }

    if (message.type === 'lsp.documentSymbol') {
      handleLspDocumentSymbol(message, sendResponse).catch((err) =>
        console.error('[CodeViewer] handleLspDocumentSymbol error:', err),
      )
      return
    }

    // git.*  → gitProvider (T043)
    if (message.type === 'git.status') {
      handleGitStatus(message, sendResponse).catch((err) =>
        console.error('[CodeViewer] handleGitStatus error:', err),
      )
      return
    }

    if (message.type === 'git.diff') {
      handleGitDiff(message, sendResponse).catch((err) =>
        console.error('[CodeViewer] handleGitDiff error:', err),
      )
      return
    }

    // chat.* → copilotProvider (T048)
    if (message.type === 'chat.listSessions') {
      handleChatListSessions(message, sendResponse).catch((err) =>
        console.error('[CodeViewer] handleChatListSessions error:', err),
      )
      return
    }

    if (message.type === 'chat.getHistory') {
      handleChatGetHistory(message, sendResponse).catch((err) =>
        console.error('[CodeViewer] handleChatGetHistory error:', err),
      )
      return
    }

    if (message.type === 'chat.send') {
      handleChatSend(message, sendResponse, client).catch((err) =>
        console.error('[CodeViewer] handleChatSend error:', err),
      )
      return
    }

    // review.* → copilotProvider (T054)
    if (message.type === 'review.listPendingEdits') {
      handleReviewListPendingEdits(message, sendResponse).catch((err) =>
        console.error('[CodeViewer] handleReviewListPendingEdits error:', err),
      )
      return
    }

    if (message.type === 'review.getEditDiff') {
      handleReviewGetEditDiff(message, sendResponse).catch((err) =>
        console.error('[CodeViewer] handleReviewGetEditDiff error:', err),
      )
      return
    }

    if (message.type === 'review.approveEdit') {
      handleReviewApproveEdit(message, sendResponse).catch((err) =>
        console.error('[CodeViewer] handleReviewApproveEdit error:', err),
      )
      return
    }

    if (message.type === 'review.rejectEdit') {
      handleReviewRejectEdit(message, sendResponse).catch((err) =>
        console.error('[CodeViewer] handleReviewRejectEdit error:', err),
      )
      return
    }

    if (message.type === 'review.listToolRequests') {
      handleReviewListToolRequests(message, sendResponse).catch((err) =>
        console.error('[CodeViewer] handleReviewListToolRequests error:', err),
      )
      return
    }

    if (message.type === 'review.acceptTool') {
      handleReviewAcceptTool(message, sendResponse).catch((err) =>
        console.error('[CodeViewer] handleReviewAcceptTool error:', err),
      )
      return
    }

    if (message.type === 'review.skipTool') {
      handleReviewSkipTool(message, sendResponse).catch((err) =>
        console.error('[CodeViewer] handleReviewSkipTool error:', err),
      )
      return
    }

    // tour.* → tourProvider (T059)
    if (message.type === 'tour.list') {
      handleTourList(message, sendResponse).catch((err) =>
        console.error('[CodeViewer] handleTourList error:', err),
      )
      return
    }

    if (message.type === 'tour.getSteps') {
      handleTourGetSteps(message, sendResponse).catch((err) =>
        console.error('[CodeViewer] handleTourGetSteps error:', err),
      )
      return
    }

    console.log(`[CodeViewer] Unhandled message type: ${message.type}`)
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
    const backendUrl = vscode.workspace.getConfiguration('codeViewer').get<string>('backendUrl', 'ws://localhost:3000')
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

  // Auto-connect on activation
  const backendUrl = vscode.workspace.getConfiguration('codeViewer').get<string>('backendUrl', 'ws://localhost:3000')
  wsClient.connect(backendUrl, extensionId, displayName)
}

export function deactivate() {
  wsClient?.disconnect()
}
