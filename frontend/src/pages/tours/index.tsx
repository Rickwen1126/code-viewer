import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router'
import { Copy } from 'lucide-react'
import { useWebSocket } from '../../hooks/use-websocket'
import { useWorkspace } from '../../hooks/use-workspace'
import { useTourEdit } from '../../hooks/use-tour-edit'
import { PullToRefresh } from '../../components/pull-to-refresh'
import { buildTourStepUrl } from '../../services/semantic-navigation'
import { getResumeTourStep } from './tour-progress'
import type { TourListResultPayload, TourCreateResultPayload } from '@code-viewer/shared'

type TourSummary = TourListResultPayload['tours'][number]

function buildTourAbsolutePath(rootPath: string, tourId: string): string {
  return `${rootPath}/.tours/${tourId}.tour`
}

async function copyText(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Fallback below for insecure contexts / Safari oddities
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  const ok = document.execCommand('copy')
  document.body.removeChild(textarea)
  if (!ok) throw new Error('Copy failed')
}

export function TourListPage() {
  const { request, connectionState } = useWebSocket()
  const { workspace, workspaceReady } = useWorkspace()
  const { tourEdit, setTourEdit } = useTourEdit()
  const navigate = useNavigate()
  const [tours, setTours] = useState<TourSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showNewTour, setShowNewTour] = useState(false)
  const [newTourTitle, setNewTourTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function showToast(msg: string) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToastMsg(msg)
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 1500)
  }

  useEffect(() => {
    if (connectionState !== 'connected' || !workspace || !workspaceReady) return
    loadTours()
  }, [connectionState, workspace, workspaceReady])

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

  async function handleCopyTourPath(tourId: string) {
    if (!workspace) return
    try {
      await copyText(buildTourAbsolutePath(workspace.rootPath, tourId))
      showToast('Copied tour path')
    } catch {
      showToast('Failed to copy tour path')
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
      ) : tours.map((tour) => {
        const isEditing = tourEdit?.tourId === tour.id
        return (
          <div
            key={tour.id}
            style={{
              borderBottom: '1px solid #2a2a2a',
              background: isEditing ? '#1a2a3a' : 'none',
              borderLeft: isEditing ? '3px solid #569cd6' : '3px solid transparent',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <button
                onClick={() => void handleCopyTourPath(tour.id)}
                title={workspace ? buildTourAbsolutePath(workspace.rootPath, tour.id) : undefined}
                aria-label={`Copy path for ${tour.title}`}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#888',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '8px 6px 8px 12px',
                  flexShrink: 0,
                }}
              >
                <Copy size={14} />
              </button>
              <button
                onClick={() => navigate(buildTourStepUrl(
                  tour.id,
                  getResumeTourStep(workspace, tour.id, tour.stepCount),
                ))}
                style={{
                  flex: 1,
                  padding: '14px 16px 14px 8px',
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
              {isEditing && (
                <button
                  onClick={(e) => { e.stopPropagation(); setTourEdit(null) }}
                  style={{
                    background: '#569cd6',
                    border: 'none',
                    color: '#fff',
                    fontSize: 12,
                    padding: '4px 12px',
                    borderRadius: 4,
                    cursor: 'pointer',
                    marginRight: 16,
                    flexShrink: 0,
                  }}
                >
                  Done
                </button>
              )}
            </div>
            {isEditing && (
              <div style={{ padding: '0 16px 10px', fontSize: 12, color: '#569cd6' }}>
                Adding steps... (Step {tourEdit!.afterIndex + 2})
              </div>
            )}
          </div>
        )
      })}
      {toastMsg && (
        <div
          style={{
            position: 'fixed',
            bottom: 'calc(72px + env(safe-area-inset-bottom))',
            left: '50%',
            transform: 'translateX(-50%)',
            background: toastMsg.startsWith('Failed') ? '#5a3030' : '#333',
            color: toastMsg.startsWith('Failed') ? '#f48771' : '#d4d4d4',
            padding: '8px 14px',
            borderRadius: 6,
            fontSize: 13,
            zIndex: 1000,
            whiteSpace: 'nowrap',
          }}
        >
          {toastMsg}
        </div>
      )}
      </div>
    </PullToRefresh>
  )
}
