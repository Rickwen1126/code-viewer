import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router'
import { useWebSocket } from '../../hooks/use-websocket'
import { useWorkspace } from '../../hooks/use-workspace'
import { useTourEdit } from '../../hooks/use-tour-edit'
import { PullToRefresh } from '../../components/pull-to-refresh'
import type { TourListResultPayload, TourCreateResultPayload } from '@code-viewer/shared'

type TourSummary = TourListResultPayload['tours'][number]

export function TourListPage() {
  const { request, connectionState } = useWebSocket()
  const { workspace } = useWorkspace()
  const { setTourEdit } = useTourEdit()
  const navigate = useNavigate()
  const [tours, setTours] = useState<TourSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showNewTour, setShowNewTour] = useState(false)
  const [newTourTitle, setNewTourTitle] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (connectionState !== 'connected' || !workspace) return
    loadTours()
  }, [connectionState, workspace])

  const loadTours = useCallback(async () => {
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
  }, [request])

  async function handleCreateTour() {
    if (!newTourTitle.trim() || !workspace) return
    try {
      setCreating(true)
      const res = await request<{ title: string }, TourCreateResultPayload>('tour.create', {
        title: newTourTitle.trim(),
      })
      setTourEdit({
        tourId: res.payload.tourId,
        tourTitle: newTourTitle.trim(),
        extensionId: workspace.extensionId,
        afterIndex: -1,
      })
      setShowNewTour(false)
      setNewTourTitle('')
      navigate('/files')
    } catch (err) {
      console.error('[TourListPage] create error:', err)
      setError('Failed to create tour')
    } finally {
      setCreating(false)
    }
  }

  function handleEditTour(e: React.MouseEvent, tour: TourSummary) {
    e.stopPropagation()
    if (!workspace) return
    setTourEdit({
      tourId: tour.id,
      tourTitle: tour.title,
      extensionId: workspace.extensionId,
      afterIndex: tour.stepCount - 1, // append after last step
    })
    navigate('/files')
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

  return (
    <PullToRefresh onRefresh={loadTours}>
      <div>
      <div style={{ padding: '12px 16px', paddingTop: 'calc(12px + env(safe-area-inset-top))', borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 16, fontWeight: 600, color: '#d4d4d4' }}>Code Tours</span>
        <button
          onClick={() => setShowNewTour(true)}
          style={{
            background: '#569cd6',
            border: 'none',
            color: '#fff',
            fontSize: 13,
            padding: '4px 12px',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          + New Tour
        </button>
      </div>

      {/* New Tour input */}
      {showNewTour && (
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #333', display: 'flex', gap: 8 }}>
          <input
            autoFocus
            placeholder="Tour title..."
            value={newTourTitle}
            onChange={(e) => setNewTourTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreateTour(); if (e.key === 'Escape') { setShowNewTour(false); setNewTourTitle('') } }}
            style={{
              flex: 1,
              background: '#2a2a2a',
              border: '1px solid #444',
              borderRadius: 4,
              color: '#d4d4d4',
              fontSize: 14,
              padding: '6px 10px',
              outline: 'none',
            }}
          />
          <button
            onClick={handleCreateTour}
            disabled={creating || !newTourTitle.trim()}
            style={{
              background: creating ? '#333' : '#569cd6',
              border: 'none',
              color: '#fff',
              fontSize: 13,
              padding: '6px 14px',
              borderRadius: 4,
              cursor: creating ? 'default' : 'pointer',
            }}
          >
            {creating ? '...' : 'Create'}
          </button>
          <button
            onClick={() => { setShowNewTour(false); setNewTourTitle('') }}
            style={{
              background: 'none',
              border: '1px solid #444',
              color: '#888',
              fontSize: 13,
              padding: '6px 10px',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {tours.length === 0 ? (
        <div style={{ padding: 32, textAlign: 'center', color: '#888' }}>
          <div style={{ fontSize: 16, marginBottom: 8 }}>No tours found</div>
          <div style={{ fontSize: 13 }}>Tap "+ New Tour" to create one</div>
        </div>
      ) : tours.map((tour) => (
        <div
          key={tour.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            borderBottom: '1px solid #2a2a2a',
          }}
        >
          <button
            onClick={() => navigate(`/tours/${encodeURIComponent(tour.id)}`)}
            style={{
              flex: 1,
              padding: '14px 16px',
              background: 'none',
              border: 'none',
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
          <button
            onClick={(e) => handleEditTour(e, tour)}
            style={{
              background: 'none',
              border: '1px solid #444',
              color: '#569cd6',
              fontSize: 12,
              padding: '4px 12px',
              borderRadius: 4,
              cursor: 'pointer',
              marginRight: 16,
              flexShrink: 0,
            }}
          >
            Edit
          </button>
        </div>
      ))}
      </div>
    </PullToRefresh>
  )
}
