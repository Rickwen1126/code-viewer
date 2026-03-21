import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router'
import { useWebSocket } from '../../hooks/use-websocket'
import { wsClient } from '../../services/ws-client'
import { useWorkspace } from '../../hooks/use-workspace'
import { PullToRefresh } from '../../components/pull-to-refresh'
import type {
  ListWorkspacesResultPayload,
  SelectWorkspaceResultPayload,
} from '@code-viewer/shared'

export function WorkspacesPage() {
  const { connectionState, request } = useWebSocket()
  const { selectWorkspace } = useWorkspace()
  const navigate = useNavigate()
  const [workspaces, setWorkspaces] = useState<ListWorkspacesResultPayload['workspaces']>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (connectionState !== 'connected') return
    loadWorkspaces()

    // Subscribe to extension connect/disconnect events
    const unsub1 = wsClient.subscribe('connection.extensionConnected', () => loadWorkspaces())
    const unsub2 = wsClient.subscribe('connection.extensionDisconnected', () => loadWorkspaces())
    return () => {
      unsub1()
      unsub2()
    }
  }, [connectionState])

  const loadWorkspaces = useCallback(async () => {
    try {
      setLoading(true)
      const res = await request<{}, ListWorkspacesResultPayload>('connection.listWorkspaces', {})
      setWorkspaces(res.payload.workspaces)
    } catch {
      // handle error
    } finally {
      setLoading(false)
    }
  }, [request])

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

  if (loading) return <div style={{ padding: 16, color: '#888' }}>Loading workspaces...</div>
  if (workspaces.length === 0)
    return <div style={{ padding: 16, color: '#888' }}>No VS Code instances connected</div>

  return (
    <PullToRefresh onRefresh={loadWorkspaces}>
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
    </PullToRefresh>
  )
}
