/**
 * Desktop workspace selector popover.
 * Pops out to the right of the activity bar when the workspace icon is clicked.
 * Lists connected workspaces, clicking one selects it and closes the popover.
 */
import { useState, useEffect, useRef, useCallback } from 'react'
import { useWebSocket } from '../../hooks/use-websocket'
import { useWorkspace } from '../../hooks/use-workspace'
import { wsClient } from '../../services/ws-client'
import { cacheService, type WorkspaceEntry } from '../../services/cache'
import { isSameWorkspace } from '../../services/selected-workspace'
import type {
  ListWorkspacesResultPayload,
  SelectWorkspaceResultPayload,
  ExtensionConnectedPayload,
  ExtensionDisconnectedPayload,
} from '@code-viewer/shared'

export function WorkspacePopover({ onClose }: { onClose: () => void }) {
  const { connectionState, request } = useWebSocket()
  const { workspace: currentWorkspace, selectWorkspace } = useWorkspace()
  const [workspaces, setWorkspaces] = useState<WorkspaceEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [selectingId, setSelectingId] = useState<string | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // Delay to avoid the opening click from immediately closing
    const timer = setTimeout(() => document.addEventListener('mousedown', handleClick), 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClick)
    }
  }, [onClose])

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  // Load cached list first
  useEffect(() => {
    cacheService.getWorkspaceList().then(cached => {
      if (cached && cached.length > 0) {
        setWorkspaces(cached)
        setLoading(false)
      }
    })
  }, [])

  // Fetch live list
  useEffect(() => {
    if (connectionState !== 'connected') return
    request<Record<string, never>, ListWorkspacesResultPayload>(
      'connection.listWorkspaces', {},
    ).then(res => {
      setWorkspaces(res.payload.workspaces)
      cacheService.setWorkspaceList(res.payload.workspaces)
      setLoading(false)
    }).catch(() => {
      setLoading(false)
    })
  }, [connectionState, request])

  // Live events
  useEffect(() => {
    const unsub1 = wsClient.subscribe('connection.extensionConnected', (msg) => {
      const p = msg.payload as ExtensionConnectedPayload
      setWorkspaces(prev => {
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

  const handleSelect = useCallback(async (extensionId: string) => {
    setSelectingId(extensionId)
    try {
      const res = await request<{ extensionId: string }, SelectWorkspaceResultPayload>(
        'connection.selectWorkspace',
        { extensionId },
      )
      selectWorkspace(res.payload.workspace)
      onClose()
    } catch {
      // Refresh list on failure
      try {
        const listRes = await request<Record<string, never>, ListWorkspacesResultPayload>(
          'connection.listWorkspaces', {},
        )
        setWorkspaces(listRes.payload.workspaces)
        cacheService.setWorkspaceList(listRes.payload.workspaces)
      } catch { /* ignore */ }
    } finally {
      setSelectingId(null)
    }
  }, [request, selectWorkspace, onClose])

  return (
    <div
      ref={popoverRef}
      style={{
        position: 'fixed',
        bottom: 8,
        left: 52,
        width: 260,
        background: '#1e1e1e',
        border: '1px solid #444',
        borderRadius: 6,
        boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
        zIndex: 1000,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{
        padding: '8px 12px',
        borderBottom: '1px solid #333',
        fontSize: 12,
        color: '#888',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
      }}>
        Workspaces
      </div>

      {/* List */}
      <div style={{ maxHeight: 300, overflow: 'auto' }}>
        {loading && workspaces.length === 0 && (
          <div style={{ padding: 16, color: '#888', fontSize: 12, textAlign: 'center' }}>
            Loading...
          </div>
        )}

        {!loading && workspaces.length === 0 && (
          <div style={{ padding: 16, color: '#888', fontSize: 12, textAlign: 'center' }}>
            No workspaces connected
          </div>
        )}

        {workspaces.map((ws) => {
          const isSelected = isSameWorkspace(currentWorkspace, ws)
          const isSelecting = selectingId === ws.extensionId
          return (
            <button
              key={ws.extensionId}
              onClick={() => handleSelect(ws.extensionId)}
              disabled={!!selectingId}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '8px 12px',
                background: isSelected ? '#1a2a3a' : 'none',
                border: 'none',
                borderBottom: '1px solid #2a2a2a',
                borderLeft: isSelected ? '2px solid #569cd6' : '2px solid transparent',
                color: '#d4d4d4',
                textAlign: 'left',
                cursor: isSelecting ? 'wait' : 'pointer',
                opacity: selectingId && !isSelecting ? 0.5 : 1,
              }}
              onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = '#2a2d2e' }}
              onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'none' }}
            >
              {/* Status dot */}
              <div style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: ws.status === 'connected' ? '#4ec9b0' : '#888',
                flexShrink: 0,
              }} />

              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 13,
                  fontWeight: isSelected ? 600 : 400,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {ws.displayName}
                </div>
                {ws.gitBranch && (
                  <div style={{ fontSize: 10, color: '#569cd6', marginTop: 1 }}>
                    {ws.gitBranch}
                  </div>
                )}
              </div>

              {/* Selected indicator */}
              {isSelected && (
                <span style={{ fontSize: 11, color: '#569cd6', flexShrink: 0 }}>current</span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
