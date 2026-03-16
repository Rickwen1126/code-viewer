import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router'
import { useWebSocket } from '../../hooks/use-websocket'
import { wsClient } from '../../services/ws-client'
import type { ChatListSessionsResultPayload, ChatSessionUpdatedPayload } from '@code-viewer/shared'

interface SessionEntry {
  id: string
  title: string
  createdAt: number
  lastActiveAt: number
  turnCount: number
  mode: 'ask' | 'agent' | 'plan'
}

function ModeBadge({ mode }: { mode: 'ask' | 'agent' | 'plan' }) {
  const colors: Record<string, string> = {
    ask: '#3b82f6',
    agent: '#8b5cf6',
    plan: '#10b981',
  }
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 12,
        fontSize: 11,
        fontWeight: 600,
        background: colors[mode] ?? '#555',
        color: '#fff',
        textTransform: 'uppercase',
      }}
    >
      {mode}
    </span>
  )
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function ChatSessionListPage() {
  const { request, connectionState } = useWebSocket()
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<SessionEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (connectionState !== 'connected') return
    loadSessions()

    // Subscribe to session updates
    const unsub = wsClient.subscribe('chat.sessionUpdated', (msg) => {
      const payload = msg.payload as ChatSessionUpdatedPayload
      setSessions((prev) =>
        prev.map((s) =>
          s.id === payload.sessionId ? { ...s, turnCount: payload.newTurnCount, lastActiveAt: Date.now() } : s,
        ),
      )
    })
    return unsub
  }, [connectionState])

  async function loadSessions() {
    try {
      setLoading(true)
      const res = await request<Record<string, never>, ChatListSessionsResultPayload>(
        'chat.listSessions',
        {},
      )
      setSessions(res.payload.sessions)
    } catch {
      setSessions([])
    } finally {
      setLoading(false)
    }
  }

  function handleNewChat() {
    navigate('/chat/new')
  }

  function handleSessionTap(sessionId: string) {
    navigate(`/chat/${sessionId}`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          borderBottom: '1px solid #333',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#d4d4d4' }}>Copilot Chat</h2>
        <button
          onClick={handleNewChat}
          style={{
            padding: '8px 16px',
            background: '#3b82f6',
            border: 'none',
            borderRadius: 8,
            color: '#fff',
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          + New Chat
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading ? (
          <div style={{ padding: 24, color: '#888', textAlign: 'center' }}>Loading sessions...</div>
        ) : sessions.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 48,
              gap: 16,
              color: '#888',
            }}
          >
            <span style={{ fontSize: 48 }}>💬</span>
            <p style={{ margin: 0, fontSize: 15, textAlign: 'center' }}>
              No chat sessions yet.
              <br />
              Start a new conversation with Copilot.
            </p>
            <button
              onClick={handleNewChat}
              style={{
                padding: '10px 24px',
                background: '#3b82f6',
                border: 'none',
                borderRadius: 8,
                color: '#fff',
                fontSize: 15,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Start New Chat
            </button>
          </div>
        ) : (
          sessions.map((session) => (
            <button
              key={session.id}
              onClick={() => handleSessionTap(session.id)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                width: '100%',
                padding: '14px 16px',
                background: 'none',
                border: 'none',
                borderBottom: '1px solid #2a2a2a',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 15, fontWeight: 500, color: '#d4d4d4' }}>{session.title}</span>
                <ModeBadge mode={session.mode} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: '#888' }}>
                <span>{session.turnCount} {session.turnCount === 1 ? 'turn' : 'turns'}</span>
                <span>·</span>
                <span>{formatRelativeTime(session.lastActiveAt)}</span>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
