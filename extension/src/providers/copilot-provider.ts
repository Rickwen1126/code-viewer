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

// chat.send — send a message to Copilot
// MVP approach: use vscode.lm API to send a chat message
export async function handleChatSend(
  msg: WsMessage,
  sendResponse: (msg: WsMessage) => void,
  wsClient?: WsClient,
): Promise<void> {
  const { sessionId, message, mode: _mode } = msg.payload as {
    sessionId?: string
    message: string
    mode?: string
  }
  const turnId = crypto.randomUUID()
  const newSessionId = sessionId ?? crypto.randomUUID()

  try {
    // Use vscode.lm API to send chat request
    const models = await vscode.lm.selectChatModels({ family: 'gpt-4o' })
    if (models.length === 0) {
      // Fallback: try any available model
      const allModels = await vscode.lm.selectChatModels()
      if (allModels.length === 0) {
        sendResponse(
          createMessage(
            'chat.send.result',
            {
              turnId,
              sessionId: newSessionId,
              response:
                'No language models available. Please ensure GitHub Copilot is installed and active.',
              model: 'none',
            },
            msg.id,
          ),
        )
        return
      }
      models.push(allModels[0])
    }

    const chatModel = models[0]
    const messages = [vscode.LanguageModelChatMessage.User(message)]
    const cts = new vscode.CancellationTokenSource()
    try {
      const response = await chatModel.sendRequest(messages, {}, cts.token)

      let fullResponse = ''
      for await (const chunk of response.text) {
        fullResponse += chunk
        // Send streaming chunk
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
