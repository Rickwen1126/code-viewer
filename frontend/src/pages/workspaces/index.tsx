import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'
import { useWebSocket } from '../../hooks/use-websocket'
import { wsClient } from '../../services/ws-client'
import { useWorkspace } from '../../hooks/use-workspace'
import { cacheService, type WorkspaceEntry } from '../../services/cache'
import type {
  ListWorkspacesResultPayload,
  SelectWorkspaceResultPayload,
  ExtensionConnectedPayload,
  ExtensionDisconnectedPayload,
} from '@code-viewer/shared'

export function WorkspacesPage() {
  const { connectionState, request } = useWebSocket()
  const { workspace: currentWorkspace, selectWorkspace } = useWorkspace()
  const navigate = useNavigate()
  const [workspaces, setWorkspaces] = useState<WorkspaceEntry[]>([])
  const [initialLoading, setInitialLoading] = useState(true)
  const [selectingId, setSelectingId] = useState<string | null>(null)

  const requestRef = useRef(request)
  requestRef.current = request
  const networkLoaded = useRef(false)

  // 1. Load cached list — only if network hasn't responded yet
  useEffect(() => {
    cacheService.getWorkspaceList().then(cached => {
      if (cached && cached.length > 0 && !networkLoaded.current) {
        setWorkspaces(cached)
        setInitialLoading(false)
      }
    })
  }, [])

  // 2. Subscribe to live events
  useEffect(() => {
    const unsub1 = wsClient.subscribe('connection.extensionConnected', (msg) => {
      const p = msg.payload as ExtensionConnectedPayload
      setWorkspaces(prev => {
        // Dedup by stable workspace identity, not runtime extensionId.
        const next = prev.filter(w => w.workspaceKey !== p.workspaceKey)
        next.push({
          extensionId: p.extensionId,
          workspaceKey: p.workspaceKey,
          displayName: p.displayName,
          rootPath: p.rootPath,
          gitBranch: null,
          extensionVersion: p.extensionVersion,
          status: 'connected' as const,
        })
        cacheService.setWorkspaceList(next)
        return next
      })
      setInitialLoading(false)
    })

    const unsub2 = wsClient.subscribe('connection.extensionDisconnected', (msg) => {
      const p = msg.payload as ExtensionDisconnectedPayload
      setWorkspaces(prev => {
        const next = prev.filter(w => w.extensionId !== p.extensionId)
        cacheService.setWorkspaceList(next)
        return next
      })
    })

    return () => { unsub1(); unsub2() }
  }, [])

  // 3. Fetch full list when WS connects — this is the source of truth
  useEffect(() => {
    if (connectionState !== 'connected') return

    requestRef.current<Record<string, never>, ListWorkspacesResultPayload>(
      'connection.listWorkspaces', {}
    ).then(res => {
      networkLoaded.current = true
      setWorkspaces(res.payload.workspaces)
      cacheService.setWorkspaceList(res.payload.workspaces)
      setInitialLoading(false)
    }).catch(() => {
      setInitialLoading(false)
    })
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
      // Extension might have restarted with new ID — refresh list
      try {
        const listRes = await request<Record<string, never>, ListWorkspacesResultPayload>(
          'connection.listWorkspaces', {}
        )
        setWorkspaces(listRes.payload.workspaces)
        cacheService.setWorkspaceList(listRes.payload.workspaces)
      } catch { /* ignore */ }
    } finally {
      setSelectingId(null)
    }
  }

  return (
    <div style={{ padding: 16, paddingTop: 'calc(16px + env(safe-area-inset-top))' }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16, color: '#d4d4d4' }}>
        Workspaces
      </h1>

      {/* Workspace list — show cached or live, each row independently clickable */}
      {workspaces.map((ws) => {
        const isSelected = currentWorkspace?.extensionId === ws.extensionId
        return (
        <button
          key={ws.extensionId}
          onClick={() => handleSelectWorkspace(ws.extensionId)}
          disabled={!!selectingId}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            width: '100%',
            padding: 16,
            marginBottom: 8,
            background: isSelected ? '#1a2a3a' : '#252526',
            border: isSelected ? '1px solid #569cd6' : '1px solid #333',
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
        )
      })}

      {/* Empty state */}
      {workspaces.length === 0 && (
        <div style={{ textAlign: 'center', paddingTop: 40 }}>
          <Spinner />
          <div style={{ color: '#888', fontSize: 14, marginTop: 12 }}>
            {initialLoading ? 'Loading workspaces...' : 'Waiting for VS Code extension...'}
          </div>
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
