import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'
import { useWebSocket } from '../../hooks/use-websocket'
import { wsClient } from '../../services/ws-client'
import { useWorkspace } from '../../hooks/use-workspace'
import type {
  ListWorkspacesResultPayload,
  SelectWorkspaceResultPayload,
  ExtensionConnectedPayload,
  ExtensionDisconnectedPayload,
} from '@code-viewer/shared'

type WorkspaceEntry = ListWorkspacesResultPayload['workspaces'][number]

export function WorkspacesPage() {
  const { connectionState, request } = useWebSocket()
  const { selectWorkspace } = useWorkspace()
  const navigate = useNavigate()
  const [workspaces, setWorkspaces] = useState<WorkspaceEntry[]>([])
  const [initialLoading, setInitialLoading] = useState(true)
  const [selectingId, setSelectingId] = useState<string | null>(null)

  const requestRef = useRef(request)
  requestRef.current = request

  // Fetch full workspace list on connect
  useEffect(() => {
    if (connectionState !== 'connected') {
      setInitialLoading(true)
      return
    }

    requestRef.current<Record<string, never>, ListWorkspacesResultPayload>(
      'connection.listWorkspaces', {}
    ).then(res => {
      setWorkspaces(res.payload.workspaces)
      setInitialLoading(false)
    }).catch(() => {
      setInitialLoading(false)
    })

    // Live updates: extension connects → add to list immediately
    const unsub1 = wsClient.subscribe('connection.extensionConnected', (msg) => {
      const p = msg.payload as ExtensionConnectedPayload
      setWorkspaces(prev => {
        // Avoid duplicates
        if (prev.some(w => w.extensionId === p.extensionId)) return prev
        return [...prev, {
          extensionId: p.extensionId,
          displayName: p.displayName,
          rootPath: p.rootPath,
          gitBranch: null,
          status: 'connected' as const,
        }]
      })
      setInitialLoading(false)
    })

    // Live updates: extension disconnects → remove from list
    const unsub2 = wsClient.subscribe('connection.extensionDisconnected', (msg) => {
      const p = msg.payload as ExtensionDisconnectedPayload
      setWorkspaces(prev => prev.filter(w => w.extensionId !== p.extensionId))
    })

    return () => { unsub1(); unsub2() }
  }, [connectionState])

  async function handleSelectWorkspace(extensionId: string) {
    setSelectingId(extensionId)
    try {
      const res = await request<{ extensionId: string }, SelectWorkspaceResultPayload>(
        'connection.selectWorkspace',
        { extensionId },
      )
      selectWorkspace(res.payload.workspace)
      navigate('/files')
    } catch {
      // handle error
    } finally {
      setSelectingId(null)
    }
  }

  // Connecting to backend
  if (connectionState !== 'connected') {
    return (
      <div style={{ padding: 16, paddingTop: 'calc(16px + env(safe-area-inset-top))', textAlign: 'center', paddingBlock: 80 }}>
        <Spinner />
        <div style={{ color: '#888', fontSize: 14, marginTop: 12 }}>Connecting to backend...</div>
      </div>
    )
  }

  return (
    <div style={{ padding: 16, paddingTop: 'calc(16px + env(safe-area-inset-top))' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16, color: '#d4d4d4' }}>
        Workspaces
      </h1>

      {/* Workspace list — each row independently clickable */}
      {workspaces.map((ws) => (
        <button
          key={ws.extensionId}
          onClick={() => handleSelectWorkspace(ws.extensionId)}
          disabled={selectingId === ws.extensionId}
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
            cursor: selectingId === ws.extensionId ? 'wait' : 'pointer',
            minHeight: 44,
            opacity: selectingId && selectingId !== ws.extensionId ? 0.5 : 1,
          }}
        >
          {selectingId === ws.extensionId ? (
            <Spinner size={8} />
          ) : (
            <div
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: ws.status === 'connected' ? '#4ec9b0' : '#888',
                flexShrink: 0,
              }}
            />
          )}
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

      {/* Empty state */}
      {workspaces.length === 0 && (
        <div style={{ textAlign: 'center', paddingTop: 40 }}>
          {initialLoading ? (
            <>
              <Spinner />
              <div style={{ color: '#888', fontSize: 14, marginTop: 12 }}>Loading workspaces...</div>
            </>
          ) : (
            <>
              <div style={{ color: '#888', fontSize: 14 }}>No VS Code instances connected</div>
              <div style={{ color: '#555', fontSize: 12, marginTop: 4 }}>Waiting for extension...</div>
              <div style={{ marginTop: 12 }}><Spinner color="#555" /></div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Spinner({ size = 20, color = '#569cd6' }: { size?: number; color?: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        border: `2px solid ${color}33`,
        borderTop: `2px solid ${color}`,
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
        verticalAlign: 'middle',
      }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </span>
  )
}
