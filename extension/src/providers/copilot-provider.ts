import * as vscode from 'vscode'
import type { WsMessage } from '@code-viewer/shared'
import { createMessage } from '../ws/client'
import type { WsClient } from '../ws/client'

// ── Review handlers (T054) ───────────────────────────────────────────────────

// review.listPendingEdits — list pending Copilot edits
// MVP: Return empty list. Real implementation would query Copilot's pending edits
// via commands like 'chat.review.list' or by reading workspace edit state
export async function handleReviewListPendingEdits(
  msg: WsMessage,
  sendResponse: (msg: WsMessage) => void,
): Promise<void> {
  sendResponse(createMessage('review.listPendingEdits.result', { edits: [] }, msg.id))
}

// review.getEditDiff
export async function handleReviewGetEditDiff(
  msg: WsMessage,
  sendResponse: (msg: WsMessage) => void,
): Promise<void> {
  const { editId } = msg.payload as { editId: string }
  sendResponse(
    createMessage(
      'review.getEditDiff.result',
      {
        id: editId,
        diff: { path: '', hunks: [] },
      },
      msg.id,
    ),
  )
}

// review.approveEdit
export async function handleReviewApproveEdit(
  msg: WsMessage,
  sendResponse: (msg: WsMessage) => void,
): Promise<void> {
  const { editId: _editId } = msg.payload as { editId: string }
  try {
    // Would call: vscode.commands.executeCommand('chat.review.apply', editId)
    sendResponse(createMessage('review.approveEdit.result', { ok: true }, msg.id))
  } catch {
    sendResponse(
      createMessage(
        'review.approveEdit.error',
        { code: 'INVALID_REQUEST', message: 'Failed to approve edit' },
        msg.id,
      ),
    )
  }
}

// review.rejectEdit
export async function handleReviewRejectEdit(
  msg: WsMessage,
  sendResponse: (msg: WsMessage) => void,
): Promise<void> {
  const { editId: _editId } = msg.payload as { editId: string }
  try {
    sendResponse(createMessage('review.rejectEdit.result', { ok: true }, msg.id))
  } catch {
    sendResponse(
      createMessage(
        'review.rejectEdit.error',
        { code: 'INVALID_REQUEST', message: 'Failed to reject edit' },
        msg.id,
      ),
    )
  }
}

// review.listToolRequests
export async function handleReviewListToolRequests(
  msg: WsMessage,
  sendResponse: (msg: WsMessage) => void,
): Promise<void> {
  sendResponse(createMessage('review.listToolRequests.result', { requests: [] }, msg.id))
}

// review.acceptTool
export async function handleReviewAcceptTool(
  msg: WsMessage,
  sendResponse: (msg: WsMessage) => void,
): Promise<void> {
  sendResponse(createMessage('review.acceptTool.result', { ok: true }, msg.id))
}

// review.skipTool
export async function handleReviewSkipTool(
  msg: WsMessage,
  sendResponse: (msg: WsMessage) => void,
): Promise<void> {
  sendResponse(createMessage('review.skipTool.result', { ok: true }, msg.id))
}

// chat.listSessions — list Copilot Chat sessions
// For MVP: Return a placeholder list. Real implementation would read .jsonl session files
// or use Copilot Chat API when available.
export async function handleChatListSessions(
  msg: WsMessage,
  sendResponse: (msg: WsMessage) => void,
): Promise<void> {
  sendResponse(
    createMessage(
      'chat.listSessions.result',
      {
        sessions: [],
      },
      msg.id,
    ),
  )
}

// chat.getHistory — get conversation history for a session
export async function handleChatGetHistory(
  msg: WsMessage,
  sendResponse: (msg: WsMessage) => void,
): Promise<void> {
  const { sessionId } = msg.payload as { sessionId: string }
  sendResponse(
    createMessage(
      'chat.getHistory.result',
      {
        session: { id: sessionId, title: 'Chat', mode: 'ask' as const },
        turns: [],
      },
      msg.id,
    ),
  )
}

// chat.listModels — list available language models
export async function handleChatListModels(
  msg: WsMessage,
  sendResponse: (msg: WsMessage) => void,
): Promise<void> {
  try {
    const models = await vscode.lm.selectChatModels()
    sendResponse(
      createMessage(
        'chat.listModels.result',
        {
          models: models.map((m) => ({
            id: m.id,
            name: m.name,
            family: m.family,
            vendor: m.vendor,
            maxInputTokens: m.maxInputTokens,
          })),
        },
        msg.id,
      ),
    )
  } catch {
    sendResponse(createMessage('chat.listModels.result', { models: [] }, msg.id))
  }
}

// chat.send — send a message to Copilot
// Supports: file references (include file content as context), model selection, mode
export async function handleChatSend(
  msg: WsMessage,
  sendResponse: (msg: WsMessage) => void,
  wsClient?: WsClient,
): Promise<void> {
  const { sessionId, message, mode, references, modelFamily } = msg.payload as {
    sessionId?: string
    message: string
    mode?: 'ask' | 'agent' | 'plan'
    references?: string[] // file paths to include as context
    modelFamily?: string // e.g. 'gpt-4o', 'claude-3.5-sonnet'
  }
  const turnId = crypto.randomUUID()
  const newSessionId = sessionId ?? crypto.randomUUID()

  try {
    // Select model: use specified family or fallback
    let models = modelFamily
      ? await vscode.lm.selectChatModels({ family: modelFamily })
      : await vscode.lm.selectChatModels({ family: 'gpt-4o' })

    if (models.length === 0) {
      const allModels = await vscode.lm.selectChatModels()
      if (allModels.length === 0) {
        sendResponse(
          createMessage(
            'chat.send.result',
            {
              turnId,
              sessionId: newSessionId,
              response: 'No language models available. Please ensure GitHub Copilot is installed and active.',
              model: 'none',
            },
            msg.id,
          ),
        )
        return
      }
      models = [allModels[0]]
    }

    const chatModel = models[0]

    // Build messages with optional file references as context
    const chatMessages: vscode.LanguageModelChatMessage[] = []

    // System-like instruction based on mode
    if (mode === 'plan') {
      chatMessages.push(
        vscode.LanguageModelChatMessage.User(
          'You are a software architect. Analyze the request and provide a structured implementation plan with steps, trade-offs, and considerations. Do not write code unless explicitly asked.',
        ),
      )
    }

    // Include file references as context
    if (references && references.length > 0) {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
      if (workspaceFolder) {
        const refParts: string[] = []
        for (const refPath of references) {
          try {
            const fileUri = vscode.Uri.joinPath(workspaceFolder.uri, refPath)
            const doc = vscode.workspace.textDocuments.find(
              (d) => d.uri.fsPath === fileUri.fsPath,
            )
            const content = doc
              ? doc.getText()
              : new TextDecoder('utf-8').decode(
                  await vscode.workspace.fs.readFile(fileUri),
                )
            // Truncate if too long (keep first 8000 chars)
            const truncated = content.length > 8000
              ? content.slice(0, 8000) + '\n... (truncated)'
              : content
            refParts.push(`File: ${refPath}\n\`\`\`\n${truncated}\n\`\`\``)
          } catch {
            refParts.push(`File: ${refPath} (could not read)`)
          }
        }
        chatMessages.push(
          vscode.LanguageModelChatMessage.User(
            'Here are the referenced files:\n\n' + refParts.join('\n\n'),
          ),
        )
      }
    }

    chatMessages.push(vscode.LanguageModelChatMessage.User(message))

    const cts = new vscode.CancellationTokenSource()
    try {
      const response = await chatModel.sendRequest(chatMessages, {}, cts.token)

      let fullResponse = ''
      for await (const chunk of response.text) {
        fullResponse += chunk
        wsClient?.send(
          createMessage('chat.stream.chunk', {
            replyTo: msg.id,
            chunk,
            turnId,
          }),
        )
      }

      sendResponse(
        createMessage(
          'chat.send.result',
          {
            turnId,
            sessionId: newSessionId,
            response: fullResponse,
            model: chatModel.name,
          },
          msg.id,
        ),
      )
    } finally {
      cts.dispose()
    }
  } catch (err) {
    sendResponse(
      createMessage(
        'chat.send.error',
        {
          code: 'INVALID_REQUEST',
          message: `Chat error: ${String(err)}`,
        },
        msg.id,
      ),
    )
  }
}
