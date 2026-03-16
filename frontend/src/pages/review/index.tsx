import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router'
import { useWebSocket } from '../../hooks/use-websocket'
import { useWorkspace } from '../../hooks/use-workspace'
import type {
  ReviewListPendingEditsResultPayload,
  ReviewListToolRequestsResultPayload,
} from '@code-viewer/shared'

type PendingEditItem = ReviewListPendingEditsResultPayload['edits'][number]
type ToolRequestItem = ReviewListToolRequestsResultPayload['requests'][number]

const statusColors: Record<string, string> = {
  pending: '#e2b93d',
  approved: '#4ec994',
  rejected: '#e74c3c',
  accepted: '#4ec994',
  skipped: '#888',
}

function EditCard({ edit, onPress }: { edit: PendingEditItem; onPress: () => void }) {
  return (
    <button
      onClick={onPress}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        padding: '12px 16px',
        background: '#252526',
        border: 'none',
        borderBottom: '1px solid #333',
        color: '#d4d4d4',
        textAlign: 'left',
        cursor: 'pointer',
        gap: 4,
        minHeight: 60,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
          {edit.filePath || '(unknown file)'}
        </span>
        <span
          style={{
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 10,
            background: statusColors[edit.status] ?? '#888',
            color: '#fff',
            flexShrink: 0,
          }}
        >
          {edit.status}
        </span>
      </div>
      {edit.description && (
        <span style={{ fontSize: 12, color: '#aaa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {edit.description}
        </span>
      )}
      <span style={{ fontSize: 11, color: '#666' }}>
        {edit.hunksCount} {edit.hunksCount === 1 ? 'hunk' : 'hunks'}
      </span>
    </button>
  )
}

function ToolRequestCard({
  req,
  onAccept,
  onSkip,
}: {
  req: ToolRequestItem
  onAccept: () => void
  onSkip: () => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        padding: '12px 16px',
        background: '#252526',
        borderBottom: '1px solid #333',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 14, fontWeight: 500, color: '#d4d4d4' }}>{req.toolName}</span>
        <span
          style={{
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 10,
            background: statusColors[req.status] ?? '#888',
            color: '#fff',
          }}
        >
          {req.status}
        </span>
      </div>
      <span style={{ fontSize: 12, color: '#aaa' }}>{req.description}</span>
      {Object.keys(req.parameters).length > 0 && (
        <span style={{ fontSize: 11, color: '#666', fontFamily: 'monospace' }}>
          {JSON.stringify(req.parameters).slice(0, 80)}
          {JSON.stringify(req.parameters).length > 80 ? '…' : ''}
        </span>
      )}
      {req.status === 'pending' && (
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button
            onClick={onAccept}
            style={{
              flex: 1,
              height: 44,
              background: '#2d6a2d',
              border: 'none',
              borderRadius: 6,
              color: '#fff',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Accept
          </button>
          <button
            onClick={onSkip}
            style={{
              flex: 1,
              height: 44,
              background: '#4a3d2e',
              border: 'none',
              borderRadius: 6,
              color: '#fff',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Skip
          </button>
        </div>
      )}
    </div>
  )
}

export function PendingEditsListPage() {
  const { request, connectionState } = useWebSocket()
  const { workspace } = useWorkspace()
  const navigate = useNavigate()
  const [edits, setEdits] = useState<PendingEditItem[]>([])
  const [toolRequests, setToolRequests] = useState<ToolRequestItem[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (connectionState !== 'connected' || !workspace) {
      setLoading(false)
      return
    }
    try {
      setLoading(true)
      const [editsRes, toolsRes] = await Promise.all([
        request<Record<string, never>, ReviewListPendingEditsResultPayload>(
          'review.listPendingEdits',
          {},
        ),
        request<Record<string, never>, ReviewListToolRequestsResultPayload>(
          'review.listToolRequests',
          {},
        ),
      ])
      setEdits(editsRes.payload.edits)
      setToolRequests(toolsRes.payload.requests)
    } catch {
      // keep empty lists on error
    } finally {
      setLoading(false)
    }
  }, [connectionState, workspace, request])

  useEffect(() => {
    void load()
  }, [load])

  async function handleAcceptTool(requestId: string) {
    try {
      await request<{ requestId: string }, { ok: boolean }>('review.acceptTool', { requestId })
      void load()
    } catch {
      // ignore
    }
  }

  async function handleSkipTool(requestId: string) {
    try {
      await request<{ requestId: string }, { ok: boolean }>('review.skipTool', { requestId })
      void load()
    } catch {
      // ignore
    }
  }

  if (!workspace) {
    return (
      <div style={{ padding: 16, color: '#888', textAlign: 'center', marginTop: 32 }}>
        No workspace selected
      </div>
    )
  }

  if (loading) {
    return <div style={{ padding: 16, color: '#888' }}>Loading reviews...</div>
  }

  const pendingEdits = edits.filter((e) => e.status === 'pending')
  const pendingTools = toolRequests.filter((r) => r.status === 'pending')
  const isEmpty = edits.length === 0 && toolRequests.length === 0

  return (
    <div style={{ overflowY: 'auto', height: '100%' }}>
      <div
        style={{
          padding: '12px 16px',
          background: '#1e1e1e',
          borderBottom: '1px solid #333',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ color: '#d4d4d4', fontSize: 16, fontWeight: 600 }}>Review</span>
        {(pendingEdits.length > 0 || pendingTools.length > 0) && (
          <span
            style={{
              background: '#e74c3c',
              color: '#fff',
              borderRadius: 10,
              fontSize: 11,
              padding: '2px 8px',
            }}
          >
            {pendingEdits.length + pendingTools.length} pending
          </span>
        )}
      </div>

      {isEmpty ? (
        <div style={{ padding: 32, color: '#888', textAlign: 'center' }}>
          No pending edits or tool requests
        </div>
      ) : (
        <>
          {edits.length > 0 && (
            <>
              <div
                style={{
                  padding: '8px 16px',
                  color: '#888',
                  fontSize: 12,
                  background: '#1a1a1a',
                  borderBottom: '1px solid #333',
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                }}
              >
                Pending Edits
              </div>
              {edits.map((edit) => (
                <EditCard
                  key={edit.id}
                  edit={edit}
                  onPress={() => navigate(`/review/edit/${encodeURIComponent(edit.id)}`)}
                />
              ))}
            </>
          )}

          {toolRequests.length > 0 && (
            <>
              <div
                style={{
                  padding: '8px 16px',
                  color: '#888',
                  fontSize: 12,
                  background: '#1a1a1a',
                  borderBottom: '1px solid #333',
                  textTransform: 'uppercase',
                  letterSpacing: 1,
                }}
              >
                Tool Requests
              </div>
              {toolRequests.map((req) => (
                <ToolRequestCard
                  key={req.id}
                  req={req}
                  onAccept={() => void handleAcceptTool(req.id)}
                  onSkip={() => void handleSkipTool(req.id)}
                />
              ))}
            </>
          )}
        </>
      )}
    </div>
  )
}
