import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router'
import { useWebSocket } from '../../hooks/use-websocket'
import { useWorkspace } from '../../hooks/use-workspace'
import type { TourListResultPayload } from '@code-viewer/shared'

type TourSummary = TourListResultPayload['tours'][number]

export function TourListPage() {
  const { request, connectionState } = useWebSocket()
  const { workspace } = useWorkspace()
  const navigate = useNavigate()
  const [tours, setTours] = useState<TourSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (connectionState !== 'connected' || !workspace) return
    loadTours()
  }, [connectionState, workspace])

  async function loadTours() {
    try {
      setLoading(true)
      setError(null)
      const res = await request<Record<string, never>, TourListResultPayload>('tour.list', {})
      setTours(res.payload.tours)
    } catch (err) {
      setError('Failed to load tours')
      console.error('[TourListPage] error:', err)
    } finally {
      setLoading(false)
    }
  }

  if (!workspace) {
    return <div style={{ padding: 16, color: '#888' }}>No workspace selected</div>
  }

  if (loading) {
    return <div style={{ padding: 16, color: '#888' }}>Loading tours...</div>
  }

  if (error) {
    return <div style={{ padding: 16, color: '#f48771' }}>{error}</div>
  }

  if (tours.length === 0) {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: '#888' }}>
        <div style={{ fontSize: 16, marginBottom: 8 }}>No tours found</div>
        <div style={{ fontSize: 13 }}>Add .tour files in the .tours/ directory</div>
      </div>
    )
  }

  return (
    <div style={{ overflowY: 'auto', height: '100%' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #333' }}>
        <span style={{ fontSize: 16, fontWeight: 600, color: '#d4d4d4' }}>Code Tours</span>
      </div>
      {tours.map((tour) => (
        <button
          key={tour.id}
          onClick={() => navigate(`/tours/${encodeURIComponent(tour.id)}`)}
          style={{
            display: 'block',
            width: '100%',
            padding: '14px 16px',
            background: 'none',
            border: 'none',
            borderBottom: '1px solid #2a2a2a',
            color: '#d4d4d4',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 4 }}>{tour.title}</div>
          {tour.description && (
            <div style={{ fontSize: 13, color: '#888', marginBottom: 6 }}>{tour.description}</div>
          )}
          <div style={{ fontSize: 12, color: '#569cd6' }}>
            {tour.stepCount} {tour.stepCount === 1 ? 'step' : 'steps'}
          </div>
        </button>
      ))}
    </div>
  )
}
