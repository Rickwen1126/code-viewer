import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router'
import { useWebSocket } from '../../hooks/use-websocket'
import { wsClient } from '../../services/ws-client'
import { useWorkspace } from '../../hooks/use-workspace'
import type {
  ListWorkspacesResultPayload,
  SelectWorkspaceResultPayload,
} from '@code-viewer/shared'

export function WorkspacesPage() {
  const { connectionState, request } = useWebSocket()
  const { selectWorkspace } = useWorkspace()
  const navigate = useNavigate()
  const [workspaces, setWorkspaces] = useState<ListWorkspacesResultPayload['workspaces']>([])
  const [loading, setLoading] = useState(false)

  // Use ref to avoid stale closure in event subscriptions
  const requestRef = useRef(request)
  requestRef.current = request

  const loadWorkspaces = useCallback(async () => {
    try {
      setLoading(true)
      const res = await requestRef.current<Record<string, never>, ListWorkspacesResultPayload>('connection.listWorkspaces', {})
      setWorkspaces(res.payload.workspaces)
    } catch {
      // WS not ready yet — will retry on next event
    } finally {
      setLoading(false)
    }
  }, [])

  // Load workspaces when connected, subscribe to extension events
  useEffect(() => {
    if (connectionState !== 'connected') return
    loadWorkspaces()

    const unsub1 = wsClient.subscribe('connection.extensionConnected', () => loadWorkspaces())
    const unsub2 = wsClient.subscribe('connection.extensionDisconnected', () => loadWorkspaces())
    return () => { unsub1(); unsub2() }
  }, [connectionState, loadWorkspaces])

  // Poll for workspaces while list is empty (catches extension connecting after page load)
  useEffect(() => {
    if (connectionState !== 'connected' || workspaces.length > 0) return
    const interval = setInterval(loadWorkspaces, 3000)
    return () => clearInterval(interval)
  }, [connectionState, workspaces.length, loadWorkspaces])

  async function handleSelectWorkspace(extensionId: string) {
    try {
      const res = await request<{ extensionId: string }, SelectWorkspaceResultPayload>(
        'connection.selectWorkspace',
        { extensionId },
      )
      selectWorkspace(res.payload.workspace)
      navigate('/files')
    } catch {
      // handle error
    }
  }

  // Connecting to backend
  if (connectionState !== 'connected') {
    return (
      <div style={{ padding: 16, paddingTop: 'calc(16px + env(safe-area-inset-top))', textAlign: 'center', paddingBlock: 80 }}>
        <div style={{ fontSize: 24, marginBottom: 16 }}>
          <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>&#8635;</span>
        </div>
        <div style={{ color: '#888', fontSize: 14 }}>Connecting to backend...</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    )
  }

  // Connected but no workspaces
  if (workspaces.length === 0) {
    return (
      <div style={{ padding: 16, paddingTop: 'calc(16px + env(safe-area-inset-top))', textAlign: 'center', paddingBlock: 80 }}>
        {loading ? (
          <>
            <div style={{ fontSize: 24, marginBottom: 16 }}>
              <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>&#8635;</span>
            </div>
            <div style={{ color: '#888', fontSize: 14 }}>Loading workspaces...</div>
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          </>
        ) : (
          <>
            <div style={{ color: '#888', fontSize: 14, marginBottom: 8 }}>No VS Code instances connected</div>
            <div style={{ color: '#555', fontSize: 12 }}>Waiting for extension to connect...</div>
            <div style={{ marginTop: 16 }}>
              <span style={{ display: 'inline-block', animation: 'pulse 2s ease-in-out infinite', color: '#555' }}>&#8635;</span>
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div style={{ padding: 16, paddingTop: 'calc(16px + env(safe-area-inset-top))' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16, color: '#d4d4d4' }}>
        Workspaces
      </h1>
      {workspaces.map((ws) => (
        <button
          key={ws.extensionId}
          onClick={() => handleSelectWorkspace(ws.extensionId)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            width: '100%',
            padding: 16,
            marginBottom: 8,
            background: '#252526',
            border: '1px solid #333',
            borderRadius: 8,
            color: '#d4d4d4',
            textAlign: 'left',
            cursor: 'pointer',
            minHeight: 44,
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: ws.status === 'connected' ? '#4ec9b0' : '#888',
              flexShrink: 0,
            }}
          />
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <div style={{ fontSize: 15, fontWeight: 500 }}>{ws.displayName}</div>
            <div
              style={{
                fontSize: 12,
                color: '#888',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {ws.rootPath}
            </div>
            {ws.gitBranch && (
              <div style={{ fontSize: 12, color: '#569cd6', marginTop: 2 }}>{ws.gitBranch}</div>
            )}
          </div>
        </button>
      ))}
    </div>
  )
}
