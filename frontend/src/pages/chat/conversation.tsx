import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router'
import { useWebSocket } from '../../hooks/use-websocket'
import { wsClient } from '../../services/ws-client'
import { cacheService } from '../../services/cache'
import { CodeBlock } from '../../components/code-block'
import type {
  ChatSendPayload,
  ChatSendResultPayload,
  ChatStreamChunkPayload,
  ChatGetHistoryResultPayload,
} from '@code-viewer/shared'
import type { ChatTurn } from '@code-viewer/shared'

// T052: Parse markdown response into text + code segments
function ChatMessage({ content }: { content: string }) {
  const parts = content.split(/(```[\s\S]*?```)/g)
  return (
    <div>
      {parts.map((part, i) => {
        const codeMatch = part.match(/^```(\w*)\n([\s\S]*?)\n?```$/)
        if (codeMatch) {
          return <CodeBlock key={i} code={codeMatch[2]} language={codeMatch[1] || 'text'} />
        }
        return (
          <span key={i} style={{ whiteSpace: 'pre-wrap' }}>
            {part}
          </span>
        )
      })}
    </div>
  )
}

// T051: Blinking cursor during streaming
function StreamingCursor() {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 8,
        height: 14,
        background: '#3b82f6',
        marginLeft: 2,
        verticalAlign: 'text-bottom',
        animation: 'blink 1s step-end infinite',
      }}
    />
  )
}

// Inject keyframes once
const styleTag = document.createElement('style')
styleTag.textContent = `@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }`
if (!document.head.querySelector('style[data-chat-cursor]')) {
  styleTag.setAttribute('data-chat-cursor', '1')
  document.head.appendChild(styleTag)
}

interface Turn {
  id: string
  request: string
  response: string
  responseStatus: 'complete' | 'streaming' | 'error'
  model?: string
  timestamp: number
}

function MessageBubble({ turn, isStreaming }: { turn: Turn; isStreaming: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '0 16px' }}>
      {/* User message — right/blue */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div
          style={{
            maxWidth: '80%',
            padding: '10px 14px',
            borderRadius: '18px 18px 4px 18px',
            background: '#3b82f6',
            color: '#fff',
            fontSize: 14,
            lineHeight: 1.5,
            wordBreak: 'break-word',
          }}
        >
          {turn.request}
        </div>
      </div>

      {/* Copilot response — left/dark */}
      {(turn.response || isStreaming) && (
        <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
          <div
            style={{
              maxWidth: '90%',
              padding: '10px 14px',
              borderRadius: '18px 18px 18px 4px',
              background: '#1e1e1e',
              border: '1px solid #333',
              color: '#d4d4d4',
              fontSize: 14,
              lineHeight: 1.6,
              wordBreak: 'break-word',
            }}
          >
            {turn.response ? (
              <>
                <ChatMessage content={turn.response} />
                {isStreaming && <StreamingCursor />}
              </>
            ) : (
              <span style={{ color: '#888' }}>
                Thinking<StreamingCursor />
              </span>
            )}
            {turn.responseStatus === 'error' && (
              <div style={{ color: '#ef4444', marginTop: 4, fontSize: 12 }}>
                Error sending message
              </div>
            )}
            {turn.model && turn.responseStatus === 'complete' && (
              <div style={{ marginTop: 6, fontSize: 11, color: '#555' }}>{turn.model}</div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function ChatConversationPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const { request, connectionState } = useWebSocket()
  const [turns, setTurns] = useState<Turn[]>([])
  const [inputValue, setInputValue] = useState('')
  const [sendingTurnId, setSendingTurnId] = useState<string | null>(null)
  const [isOffline, setIsOffline] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const isNewSession = sessionId === 'new'
  const activeSessionId = useRef<string>(isNewSession ? crypto.randomUUID() : (sessionId ?? crypto.randomUUID()))

  // T053: load history or offline cache on mount
  useEffect(() => {
    if (isNewSession) {
      setIsOffline(false)
      return
    }

    if (connectionState === 'connected' && sessionId) {
      loadHistory(sessionId)
    } else if (connectionState === 'disconnected' || connectionState === 'reconnecting') {
      loadFromCache(sessionId ?? '')
    }
  }, [connectionState, sessionId])

  async function loadHistory(sid: string) {
    try {
      const res = await request<{ sessionId: string }, ChatGetHistoryResultPayload>(
        'chat.getHistory',
        { sessionId: sid },
      )
      const loaded: Turn[] = res.payload.turns.map((t) => ({
        id: t.id,
        request: t.request,
        response: t.response,
        responseStatus: 'complete' as const,
        model: t.model,
        timestamp: t.timestamp,
      }))
      setTurns(loaded)
      setIsOffline(false)
      // Update cache
      const session = {
        id: res.payload.session.id,
        title: res.payload.session.title,
        mode: res.payload.session.mode,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        turnCount: loaded.length,
      }
      const cacheTurns: import('@code-viewer/shared').ChatTurn[] = loaded.map((t) => ({
        ...t,
        sessionId: sid,
      }))
      cacheService.setChatSession(session, cacheTurns).catch(() => {})
    } catch {
      loadFromCache(sid)
    }
  }

  async function loadFromCache(sid: string) {
    const cached = await cacheService.getChatSession(sid)
    if (cached) {
      const loaded: Turn[] = cached.turns.map((t: ChatTurn) => ({
        id: t.id,
        request: t.request,
        response: t.response,
        responseStatus: 'complete' as const,
        model: t.model,
        timestamp: t.timestamp,
      }))
      setTurns(loaded)
      setIsOffline(true)
    }
  }

  // T051: Subscribe to stream chunks for the current message
  useEffect(() => {
    if (!sendingTurnId) return

    const unsub = wsClient.subscribe('chat.stream.chunk', (msg) => {
      const payload = msg.payload as ChatStreamChunkPayload
      if (payload.turnId !== sendingTurnId) return

      setTurns((prev) =>
        prev.map((t) =>
          t.id === sendingTurnId
            ? { ...t, response: t.response + payload.chunk, responseStatus: 'streaming' }
            : t,
        ),
      )
      scrollToBottom()
    })

    return unsub
  }, [sendingTurnId])

  // Auto-scroll to bottom when turns change
  useEffect(() => {
    scrollToBottom()
  }, [turns])

  function scrollToBottom() {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }

  async function handleSend() {
    const text = inputValue.trim()
    if (!text || sendingTurnId) return

    const turnId = crypto.randomUUID()
    const newTurn: Turn = {
      id: turnId,
      request: text,
      response: '',
      responseStatus: 'streaming',
      timestamp: Date.now(),
    }

    setInputValue('')
    setTurns((prev) => [...prev, newTurn])
    setSendingTurnId(turnId)
    scrollToBottom()

    try {
      const payload: ChatSendPayload = {
        sessionId: isNewSession ? activeSessionId.current : sessionId,
        message: text,
        mode: 'ask',
      }

      const res = await request<ChatSendPayload, ChatSendResultPayload>('chat.send', payload)

      const result = res.payload
      // Update the session id if we started a new session
      if (isNewSession) {
        activeSessionId.current = result.sessionId
      }

      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId
            ? { ...t, response: result.response, responseStatus: 'complete', model: result.model }
            : t,
        ),
      )

      // Update cache
      const session = {
        id: result.sessionId,
        title: text.slice(0, 50),
        mode: 'ask' as const,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        turnCount: turns.length + 1,
      }
      const cacheTurns: ChatTurn[] = [...turns, newTurn].map((t) => ({
        ...t,
        sessionId: result.sessionId,
        responseStatus: t.id === turnId ? 'complete' as const : t.responseStatus as 'complete' | 'streaming' | 'error',
        response: t.id === turnId ? result.response : t.response,
      }))
      cacheService.setChatSession(session, cacheTurns).catch(() => {})
    } catch {
      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId ? { ...t, responseStatus: 'error' } : t,
        ),
      )
    } finally {
      setSendingTurnId(null)
      inputRef.current?.focus()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 16px',
          borderBottom: '1px solid #333',
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => navigate('/chat')}
          style={{
            background: 'none',
            border: 'none',
            color: '#3b82f6',
            fontSize: 20,
            cursor: 'pointer',
            padding: '0 4px',
            lineHeight: 1,
          }}
          aria-label="Back"
        >
          ‹
        </button>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#d4d4d4', flex: 1 }}>
          {isNewSession ? 'New Chat' : 'Chat'}
        </h2>
        {isOffline && (
          <span
            style={{
              fontSize: 11,
              color: '#f59e0b',
              background: '#292524',
              padding: '2px 8px',
              borderRadius: 12,
              border: '1px solid #78350f',
            }}
          >
            Offline — read only
          </span>
        )}
      </div>

      {/* Messages area */}
      <div
        ref={scrollRef}
        style={{ flex: 1, overflowY: 'auto', padding: '16px 0', display: 'flex', flexDirection: 'column', gap: 20 }}
      >
        {turns.length === 0 && !sendingTurnId && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 1,
              color: '#666',
              padding: 32,
              gap: 8,
              textAlign: 'center',
            }}
          >
            <span style={{ fontSize: 40 }}>🤖</span>
            <p style={{ margin: 0, fontSize: 14 }}>Ask Copilot anything about your code.</p>
          </div>
        )}
        {turns.map((turn) => (
          <MessageBubble
            key={turn.id}
            turn={turn}
            isStreaming={turn.id === sendingTurnId}
          />
        ))}
      </div>

      {/* Input bar */}
      {!isOffline && (
        <div
          style={{
            flexShrink: 0,
            borderTop: '1px solid #333',
            padding: '10px 12px',
            display: 'flex',
            alignItems: 'flex-end',
            gap: 8,
            background: '#1a1a1a',
          }}
        >
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Copilot..."
            disabled={connectionState !== 'connected' || !!sendingTurnId}
            rows={1}
            style={{
              flex: 1,
              resize: 'none',
              background: '#252525',
              border: '1px solid #3a3a3a',
              borderRadius: 12,
              color: '#d4d4d4',
              fontSize: 14,
              padding: '10px 14px',
              fontFamily: 'inherit',
              lineHeight: 1.5,
              outline: 'none',
              maxHeight: 120,
              overflowY: 'auto',
            }}
            onInput={(e) => {
              const el = e.currentTarget
              el.style.height = 'auto'
              el.style.height = `${Math.min(el.scrollHeight, 120)}px`
            }}
          />
          <button
            onClick={handleSend}
            disabled={!inputValue.trim() || connectionState !== 'connected' || !!sendingTurnId}
            style={{
              flexShrink: 0,
              width: 40,
              height: 40,
              borderRadius: '50%',
              background:
                !inputValue.trim() || connectionState !== 'connected' || !!sendingTurnId
                  ? '#2a2a2a'
                  : '#3b82f6',
              border: 'none',
              color: '#fff',
              fontSize: 18,
              cursor:
                !inputValue.trim() || connectionState !== 'connected' || !!sendingTurnId
                  ? 'not-allowed'
                  : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 0.15s',
            }}
            aria-label="Send"
          >
            ↑
          </button>
        </div>
      )}
    </div>
  )
}
