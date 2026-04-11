import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router'
import { useWebSocket } from '../../hooks/use-websocket'
import { useWorkspace } from '../../hooks/use-workspace'
import type {
  ReviewGetEditDiffResultPayload,
  ReviewGetEditDiffPayload,
  ReviewEditActionPayload,
} from '@code-viewer/shared'
import type { DiffHunk, DiffChange } from '@code-viewer/shared'

// Inline diff renderer (used when diff-view.tsx from US3 is not yet available)
function InlineDiffChange({ change }: { change: DiffChange }) {
  const bgColor =
    change.type === 'add' ? '#1a3a1a' : change.type === 'delete' ? '#3a1a1a' : 'transparent'
  const linePrefix =
    change.type === 'add' ? '+' : change.type === 'delete' ? '-' : ' '
  const textColor =
    change.type === 'add' ? '#4ec994' : change.type === 'delete' ? '#e74c3c' : '#d4d4d4'

  return (
    <div
      style={{
        display: 'flex',
        background: bgColor,
        padding: '1px 8px',
        fontFamily: 'monospace',
        fontSize: 12,
        lineHeight: '18px',
        whiteSpace: 'pre',
        color: textColor,
        gap: 8,
      }}
    >
      <span style={{ color: '#555', userSelect: 'none', minWidth: 24, textAlign: 'right' }}>
        {change.newLineNumber ?? change.oldLineNumber ?? ''}
      </span>
      <span style={{ color: '#666', userSelect: 'none' }}>{linePrefix}</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{change.content}</span>
    </div>
  )
}

function InlineDiffHunk({ hunk }: { hunk: DiffHunk }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div
        style={{
          background: '#1e3a5f',
          color: '#6fa8dc',
          fontFamily: 'monospace',
          fontSize: 11,
          padding: '2px 8px',
        }}
      >
        @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
      </div>
      {hunk.changes.map((change, i) => (
        <InlineDiffChange key={i} change={change} />
      ))}
    </div>
  )
}

export function EditDiffReviewPage() {
  const { editId } = useParams<{ editId: string }>()
  const navigate = useNavigate()
  const { request, connectionState } = useWebSocket()
  const { workspace, workspaceReady } = useWorkspace()
  const [diffResult, setDiffResult] = useState<ReviewGetEditDiffResultPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<'approve' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const decodedEditId = editId ? decodeURIComponent(editId) : ''

  useEffect(() => {
    if (connectionState !== 'connected' || !workspace || !workspaceReady || !decodedEditId) {
      setLoading(false)
      return
    }

    async function loadDiff() {
      try {
        setLoading(true)
        setError(null)
        const res = await request<ReviewGetEditDiffPayload, ReviewGetEditDiffResultPayload>(
          'review.getEditDiff',
          { editId: decodedEditId },
        )
        setDiffResult(res.payload)
      } catch (err) {
        setError(String(err))
      } finally {
        setLoading(false)
      }
    }

    void loadDiff()
  }, [connectionState, workspace, workspaceReady, decodedEditId, request])

  async function handleApprove() {
    if (!decodedEditId) return
    setActionLoading('approve')
    try {
      await request<ReviewEditActionPayload, { ok: boolean }>('review.approveEdit', {
        editId: decodedEditId,
      })
      navigate(-1)
    } catch {
      setActionLoading(null)
    }
  }

  async function handleReject() {
    if (!decodedEditId) return
    setActionLoading('reject')
    try {
      await request<ReviewEditActionPayload, { ok: boolean }>('review.rejectEdit', {
        editId: decodedEditId,
      })
      navigate(-1)
    } catch {
      setActionLoading(null)
    }
  }

  if (!workspace) {
    return (
      <div style={{ padding: 16, color: '#888', textAlign: 'center', marginTop: 32 }}>
        No workspace selected
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '10px 16px',
          background: '#1e1e1e',
          borderBottom: '1px solid #333',
          gap: 10,
        }}
      >
        <button
          onClick={() => navigate(-1)}
          style={{
            background: 'none',
            border: 'none',
            color: '#569cd6',
            fontSize: 14,
            cursor: 'pointer',
            padding: '4px 0',
          }}
        >
          ← Back
        </button>
        <span style={{ color: '#d4d4d4', fontSize: 14, fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {diffResult?.diff.path || decodedEditId}
        </span>
      </div>

      {/* Diff content */}
      <div style={{ flex: 1, overflowY: 'auto', background: '#1e1e1e' }}>
        {loading && (
          <div style={{ padding: 16, color: '#888' }}>Loading diff...</div>
        )}

        {error && (
          <div style={{ padding: 16, color: '#e74c3c' }}>Error: {error}</div>
        )}

        {!loading && !error && diffResult && (
          <>
            {diffResult.diff.hunks.length === 0 ? (
              <div style={{ padding: 32, color: '#888', textAlign: 'center' }}>
                No changes to display
              </div>
            ) : (
              <div style={{ padding: '8px 0' }}>
                {diffResult.diff.hunks.map((hunk, i) => (
                  <InlineDiffHunk key={i} hunk={hunk} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Approve / Reject buttons */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          padding: '12px 16px',
          paddingBottom: 'calc(12px + env(safe-area-inset-bottom))',
          background: '#1e1e1e',
          borderTop: '1px solid #333',
        }}
      >
        <button
          onClick={() => void handleApprove()}
          disabled={actionLoading !== null || loading}
          style={{
            flex: 1,
            height: 44,
            background: actionLoading === 'approve' ? '#1a5c1a' : '#2d6a2d',
            border: 'none',
            borderRadius: 6,
            color: '#fff',
            fontSize: 15,
            fontWeight: 500,
            cursor: actionLoading !== null || loading ? 'not-allowed' : 'pointer',
            opacity: actionLoading !== null || loading ? 0.7 : 1,
          }}
        >
          {actionLoading === 'approve' ? 'Approving...' : 'Approve'}
        </button>
        <button
          onClick={() => void handleReject()}
          disabled={actionLoading !== null || loading}
          style={{
            flex: 1,
            height: 44,
            background: actionLoading === 'reject' ? '#7a1a1a' : '#a02020',
            border: 'none',
            borderRadius: 6,
            color: '#fff',
            fontSize: 15,
            fontWeight: 500,
            cursor: actionLoading !== null || loading ? 'not-allowed' : 'pointer',
            opacity: actionLoading !== null || loading ? 0.7 : 1,
          }}
        >
          {actionLoading === 'reject' ? 'Rejecting...' : 'Reject'}
        </button>
      </div>
    </div>
  )
}
