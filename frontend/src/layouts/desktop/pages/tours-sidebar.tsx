/**
 * Desktop sidebar variant of TourListPage.
 * Forked from pages/tours/index.tsx — compact layout, no pull-to-refresh,
 * expandable step list drill-down, click step navigates to /tours/:id?step=N.
 */
import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useLocation, useSearchParams } from 'react-router'
import { useWebSocket } from '../../../hooks/use-websocket'
import { useWorkspace } from '../../../hooks/use-workspace'
import { useTourEdit } from '../../../hooks/use-tour-edit'
import { buildTourStepUrl } from '../../../services/semantic-navigation'
import { getResumeTourStep } from '../../../pages/tours/tour-progress'
import type { TourListResultPayload, TourGetStepsResultPayload, TourCreateResultPayload } from '@code-viewer/shared'

type TourSummary = TourListResultPayload['tours'][number]
type TourStep = TourGetStepsResultPayload['steps'][number]

export function ToursSidebar() {
  const { request, connectionState } = useWebSocket()
  const { workspace, workspaceReady } = useWorkspace()
  const { tourEdit, setTourEdit } = useTourEdit()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()

  const [tours, setTours] = useState<TourSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedTourId, setExpandedTourId] = useState<string | null>(null)
  const [tourSteps, setTourSteps] = useState<Record<string, TourStep[]>>({})

  // New tour creation
  const [showNewTour, setShowNewTour] = useState(false)
  const [newTourTitle, setNewTourTitle] = useState('')
  const [creating, setCreating] = useState(false)

  // Derive active tour + step from URL
  const activeTourId = location.pathname.match(/^\/tours\/(.+)/)?.[1]
    ? decodeURIComponent(location.pathname.match(/^\/tours\/(.+)/)![1])
    : null
  const activeStep = searchParams.get('step') ? parseInt(searchParams.get('step')!, 10) : null

  // Auto-expand the active tour from URL and load steps if needed (e.g. after sidebar remount)
  useEffect(() => {
    if (!activeTourId) return
    if (expandedTourId !== activeTourId) {
      setExpandedTourId(activeTourId)
    }
    if (!tourSteps[activeTourId] && connectionState === 'connected') {
      request<{ tourId: string }, TourGetStepsResultPayload>('tour.getSteps', { tourId: activeTourId })
        .then(res => {
          setTourSteps(prev => ({ ...prev, [activeTourId]: res.payload.steps ?? [] }))
        })
        .catch(() => {
          setTourSteps(prev => ({ ...prev, [activeTourId]: [] }))
        })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTourId, connectionState])

  useEffect(() => {
    if (connectionState !== 'connected' || !workspace || !workspaceReady) return
    loadTours()
  }, [connectionState, workspace, workspaceReady])

  const loadTours = useCallback(async () => {
    try {
      setLoading(true)
      const res = await request<Record<string, never>, TourListResultPayload>('tour.list', {})
      setTours(res.payload.tours)
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [request])

  async function handleToggleTour(tourId: string) {
    if (expandedTourId === tourId) {
      setExpandedTourId(null)
      return
    }
    setExpandedTourId(tourId)
    if (!tourSteps[tourId]) {
      try {
        const res = await request<{ tourId: string }, TourGetStepsResultPayload>('tour.getSteps', { tourId })
        setTourSteps(prev => ({ ...prev, [tourId]: res.payload.steps ?? [] }))
      } catch {
        setTourSteps(prev => ({ ...prev, [tourId]: [] }))
      }
    }
  }

  function handleStepClick(tourId: string, stepIndex: number) {
    navigate(buildTourStepUrl(tourId, stepIndex + 1))
  }

  function handleTourClick(tour: TourSummary) {
    navigate(buildTourStepUrl(
      tour.id,
      getResumeTourStep(workspace, tour.id, tour.stepCount),
    ))
  }

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
    } catch {
      // ignore
    } finally {
      setCreating(false)
    }
  }

  if (!workspace) {
    return <div style={{ padding: 12, color: '#888', fontSize: 12 }}>No workspace selected</div>
  }

  if (loading) {
    return <div style={{ padding: 12, color: '#888', fontSize: 12 }}>Loading...</div>
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        padding: '6px 8px',
        borderBottom: '1px solid #333',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#d4d4d4' }}>Tours</span>
        <button
          onClick={() => setShowNewTour(true)}
          style={{
            background: '#569cd6',
            border: 'none',
            color: '#fff',
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 3,
            cursor: 'pointer',
          }}
        >
          + New
        </button>
      </div>

      {/* New tour input */}
      {showNewTour && (
        <div style={{ padding: '6px 8px', borderBottom: '1px solid #333', display: 'flex', gap: 4 }}>
          <input
            autoFocus
            placeholder="Tour title..."
            value={newTourTitle}
            onChange={(e) => setNewTourTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateTour()
              if (e.key === 'Escape') { setShowNewTour(false); setNewTourTitle('') }
            }}
            style={{
              flex: 1,
              background: '#2a2a2a',
              border: '1px solid #444',
              borderRadius: 3,
              color: '#d4d4d4',
              fontSize: 12,
              padding: '4px 6px',
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
              fontSize: 11,
              padding: '4px 8px',
              borderRadius: 3,
              cursor: creating ? 'default' : 'pointer',
            }}
          >
            {creating ? '...' : 'Create'}
          </button>
        </div>
      )}

      {/* Tour list with step drill-down */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {tours.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', color: '#888', fontSize: 12 }}>
            No tours found
          </div>
        ) : tours.map((tour) => {
          const isExpanded = expandedTourId === tour.id
          const isActive = activeTourId === tour.id
          const isEditing = tourEdit?.tourId === tour.id
          const steps = tourSteps[tour.id]

          return (
            <div key={tour.id}>
              {/* Tour row */}
              <button
                onClick={() => handleToggleTour(tour.id)}
                onDoubleClick={() => handleTourClick(tour)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  width: '100%',
                  padding: '6px 8px',
                  background: isActive ? '#1a2a3a' : 'none',
                  border: 'none',
                  borderLeft: isEditing ? '2px solid #569cd6' : '2px solid transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  minHeight: 32,
                }}
                onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = '#2a2d2e' }}
                onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'none' }}
              >
                <span style={{ fontSize: 9, color: '#888', width: 10 }}>{isExpanded ? '▼' : '▶'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: '#d4d4d4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {tour.title}
                  </div>
                  <div style={{ fontSize: 10, color: '#569cd6' }}>
                    {tour.stepCount} {tour.stepCount === 1 ? 'step' : 'steps'}
                  </div>
                </div>
                {isEditing && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setTourEdit(null) }}
                    style={{
                      background: '#569cd6',
                      border: 'none',
                      color: '#fff',
                      fontSize: 10,
                      padding: '2px 8px',
                      borderRadius: 3,
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                  >
                    Done
                  </button>
                )}
              </button>

              {/* Expanded: step list */}
              {isExpanded && (
                <div style={{ background: '#1a1a1a' }}>
                  {!steps ? (
                    <div style={{ padding: '6px 8px', color: '#888', fontSize: 11 }}>Loading steps...</div>
                  ) : steps.length === 0 ? (
                    <div style={{ padding: '6px 8px', color: '#888', fontSize: 11 }}>No steps</div>
                  ) : steps.map((step, i) => {
                    const isActiveStep = isActive && activeStep === i + 1
                    return (
                      <button
                        key={i}
                        onClick={() => handleStepClick(tour.id, i)}
                        style={{
                          display: 'flex',
                          gap: 6,
                          padding: '4px 8px 4px 24px',
                          background: isActiveStep ? '#264f78' : 'none',
                          border: 'none',
                          borderLeft: isActiveStep ? '2px solid #569cd6' : '2px solid transparent',
                          borderBottom: '1px solid #222',
                          width: '100%',
                          textAlign: 'left',
                          cursor: 'pointer',
                          minHeight: 26,
                        }}
                        onMouseEnter={(e) => { if (!isActiveStep) (e.currentTarget as HTMLElement).style.background = '#2a2d2e' }}
                        onMouseLeave={(e) => { if (!isActiveStep) (e.currentTarget as HTMLElement).style.background = 'none' }}
                      >
                        <span style={{ fontSize: 10, color: '#888', width: 16, flexShrink: 0, textAlign: 'right' }}>
                          {i + 1}.
                        </span>
                        <span style={{ fontSize: 12, color: isActiveStep ? '#fff' : '#d4d4d4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          {step.title || step.file.split('/').pop() || `Step ${i + 1}`}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
