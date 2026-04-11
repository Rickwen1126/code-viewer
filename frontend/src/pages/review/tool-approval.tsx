import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router'
import { useWebSocket } from '../../hooks/use-websocket'
import { useWorkspace } from '../../hooks/use-workspace'
import type {
  ReviewListToolRequestsResultPayload,
  ReviewToolActionPayload,
} from '@code-viewer/shared'

type ToolRequestItem = ReviewListToolRequestsResultPayload['requests'][number]

export function ToolApprovalPage() {
  const { requestId } = useParams<{ requestId: string }>()
  const navigate = useNavigate()
  const { request, connectionState } = useWebSocket()
  const { workspace, workspaceReady } = useWorkspace()
  const [toolRequest, setToolRequest] = useState<ToolRequestItem | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState<'accept' | 'skip' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const decodedRequestId = requestId ? decodeURIComponent(requestId) : ''

  useEffect(() => {
    if (connectionState !== 'connected' || !workspace || !workspaceReady || !decodedRequestId) {
      setLoading(false)
      return
    }

    async function loadRequest() {
      try {
        setLoading(true)
        setError(null)
        const res = await request<
          Record<string, never>,
          ReviewListToolRequestsResultPayload
        >('review.listToolRequests', {})
        const found = res.payload.requests.find((r) => r.id === decodedRequestId)
        if (found) {
          setToolRequest(found)
        } else {
          setError('Tool request not found')
        }
      } catch (err) {
        setError(String(err))
      } finally {
        setLoading(false)
      }
    }

    void loadRequest()
  }, [connectionState, workspace, workspaceReady, decodedRequestId, request])

  async function handleAccept() {
    if (!decodedRequestId) return
    setActionLoading('accept')
    try {
      await request<ReviewToolActionPayload, { ok: boolean }>('review.acceptTool', {
        requestId: decodedRequestId,
      })
      navigate(-1)
    } catch {
      setActionLoading(null)
    }
  }

  async function handleSkip() {
    if (!decodedRequestId) return
    setActionLoading('skip')
    try {
      await request<ReviewToolActionPayload, { ok: boolean }>('review.skipTool', {
        requestId: decodedRequestId,
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
        <span style={{ color: '#d4d4d4', fontSize: 14, fontWeight: 500 }}>Tool Request</span>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
        {loading && <div style={{ color: '#888' }}>Loading...</div>}
        {error && <div style={{ color: '#e74c3c' }}>Error: {error}</div>}

        {!loading && !error && toolRequest && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Tool name */}
            <div>
              <div style={{ color: '#888', fontSize: 11, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
                Tool
              </div>
              <div style={{ color: '#d4d4d4', fontSize: 16, fontWeight: 600 }}>
                {toolRequest.toolName}
              </div>
            </div>

            {/* Description */}
            <div>
              <div style={{ color: '#888', fontSize: 11, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
                Description
              </div>
              <div style={{ color: '#ccc', fontSize: 14, lineHeight: '1.5' }}>
                {toolRequest.description}
              </div>
            </div>

            {/* Parameters */}
            {Object.keys(toolRequest.parameters).length > 0 && (
              <div>
                <div style={{ color: '#888', fontSize: 11, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>
                  Parameters
                </div>
                <div
                  style={{
                    background: '#252526',
                    borderRadius: 6,
                    padding: 12,
                    fontFamily: 'monospace',
                    fontSize: 12,
                    color: '#ce9178',
                    overflowX: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {JSON.stringify(toolRequest.parameters, null, 2)}
                </div>
              </div>
            )}

            {/* Status */}
            {toolRequest.status !== 'pending' && (
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: 6,
                  background: toolRequest.status === 'accepted' ? '#1a3a1a' : '#2a2a2a',
                  color: toolRequest.status === 'accepted' ? '#4ec994' : '#888',
                  fontSize: 13,
                  textAlign: 'center',
                }}
              >
                This request has been {toolRequest.status}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Accept / Skip buttons — only shown when pending */}
      {toolRequest?.status === 'pending' && (
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
            onClick={() => void handleAccept()}
            disabled={actionLoading !== null}
            style={{
              flex: 1,
              height: 44,
              background: actionLoading === 'accept' ? '#1a5c1a' : '#2d6a2d',
              border: 'none',
              borderRadius: 6,
              color: '#fff',
              fontSize: 15,
              fontWeight: 500,
              cursor: actionLoading !== null ? 'not-allowed' : 'pointer',
              opacity: actionLoading !== null ? 0.7 : 1,
            }}
          >
            {actionLoading === 'accept' ? 'Accepting...' : 'Accept'}
          </button>
          <button
            onClick={() => void handleSkip()}
            disabled={actionLoading !== null}
            style={{
              flex: 1,
              height: 44,
              background: actionLoading === 'skip' ? '#3a3a1a' : '#4a3d2e',
              border: 'none',
              borderRadius: 6,
              color: '#fff',
              fontSize: 15,
              fontWeight: 500,
              cursor: actionLoading !== null ? 'not-allowed' : 'pointer',
              opacity: actionLoading !== null ? 0.7 : 1,
            }}
          >
            {actionLoading === 'skip' ? 'Skipping...' : 'Skip'}
          </button>
        </div>
      )}
    </div>
  )
}
