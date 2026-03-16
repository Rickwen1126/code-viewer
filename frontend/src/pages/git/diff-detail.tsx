import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router'
import { useWebSocket } from '../../hooks/use-websocket'
import { DiffView } from '../../components/diff-view'
import type { GitDiffResultPayload } from '@code-viewer/shared'

export function GitDiffDetailPage() {
  const { '*': rawPath } = useParams()
  const path = rawPath ? decodeURIComponent(rawPath) : ''
  const { request, connectionState } = useWebSocket()
  const navigate = useNavigate()
  const [diff, setDiff] = useState<GitDiffResultPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!path) return
    if (connectionState !== 'connected') {
      setLoading(false)
      return
    }
    loadDiff()
  }, [path, connectionState])

  async function loadDiff() {
    try {
      setLoading(true)
      setError(false)
      const res = await request<{ path: string }, GitDiffResultPayload>('git.diff', { path })
      setDiff(res.payload)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  const fileName = path.split('/').pop() ?? path

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid #333',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => navigate(-1)}
          style={{
            background: 'none',
            border: 'none',
            color: '#569cd6',
            fontSize: 20,
            cursor: 'pointer',
            padding: '0 4px',
            lineHeight: 1,
          }}
          aria-label="Back"
        >
          ‹
        </button>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div
            style={{
              fontSize: 13,
              color: '#d4d4d4',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {fileName}
          </div>
          {path !== fileName && (
            <div
              style={{
                fontSize: 11,
                color: '#888',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {path}
            </div>
          )}
        </div>
      </div>

      {/* Diff content */}
      <div style={{ flex: 1, overflow: 'auto', WebkitOverflowScrolling: 'touch' }}>
        {loading ? (
          <div style={{ padding: 16, color: '#888' }}>Loading diff...</div>
        ) : error ? (
          <div style={{ padding: 16, color: '#f48771' }}>
            Failed to load diff. Make sure the extension is connected.
          </div>
        ) : !diff ? (
          <div style={{ padding: 16, color: '#888' }}>No diff available.</div>
        ) : (
          <DiffView hunks={diff.hunks} />
        )}
      </div>
    </div>
  )
}
