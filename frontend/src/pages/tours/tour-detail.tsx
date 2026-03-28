import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router'
import { useWebSocket } from '../../hooks/use-websocket'
import { useWorkspace } from '../../hooks/use-workspace'
import { useTourEdit } from '../../hooks/use-tour-edit'
import { CodeBlock } from '../../components/code-block'
import { MarkdownRenderer } from '../../components/markdown-renderer'
import type { TourGetStepsResultPayload, TourGetFileAtRefResultPayload, TourDeleteStepResultPayload, TourAddStepResultPayload } from '@code-viewer/shared'

type TourData = TourGetStepsResultPayload
type TourStep = TourData['steps'][number]

// T063: Tour progress stored in localStorage
function getProgressKey(extensionId: string, tourId: string): string {
  return `tour-progress:${extensionId}:${tourId}`
}

function loadProgress(extensionId: string, tourId: string): number {
  try {
    const raw = localStorage.getItem(getProgressKey(extensionId, tourId))
    if (!raw) return 0
    const data = JSON.parse(raw) as { currentStep: number }
    return data.currentStep ?? 0
  } catch {
    return 0
  }
}

function saveProgress(extensionId: string, tourId: string, currentStep: number): void {
  try {
    localStorage.setItem(getProgressKey(extensionId, tourId), JSON.stringify({ currentStep }))
  } catch {
    // ignore
  }
}

function getLanguageFromFile(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    cs: 'csharp',
    md: 'markdown',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    sh: 'bash',
    html: 'html',
    css: 'css',
    scss: 'scss',
  }
  return map[ext] ?? 'text'
}

function extractLines(content: string, startLine: number, endLine?: number): string {
  const lines = content.split('\n')
  // lines are 1-indexed in tour steps
  const start = Math.max(0, startLine - 1)
  const end = endLine !== undefined ? Math.min(lines.length, endLine) : start + 1
  return lines.slice(start, end).join('\n')
}


export function TourDetailPage() {
  const { tourId: rawTourId } = useParams<{ tourId: string }>()
  const tourId = rawTourId ? decodeURIComponent(rawTourId) : ''
  const navigate = useNavigate()
  const { request, connectionState } = useWebSocket()
  const { workspace } = useWorkspace()

  const [tourData, setTourData] = useState<TourData | null>(null)
  const [currentStep, setCurrentStep] = useState(0)
  const [stepCode, setStepCode] = useState<string | null>(null)
  const [stepLanguage, setStepLanguage] = useState('text')
  const [loadingTour, setLoadingTour] = useState(true)
  const [loadingCode, setLoadingCode] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { setTourEdit } = useTourEdit()

  // Edit/delete state
  const [editingStep, setEditingStep] = useState(false)
  const [editSections, setEditSections] = useState<{ title: string; content: string }[]>([])
  const [savingEdit, setSavingEdit] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Load tour steps
  useEffect(() => {
    if (connectionState !== 'connected' || !workspace || !tourId) return
    loadTour()
  }, [connectionState, workspace, tourId])

  async function loadTour() {
    try {
      setLoadingTour(true)
      setError(null)
      const res = await request<{ tourId: string }, TourGetStepsResultPayload>('tour.getSteps', { tourId })
      const data = res.payload
      if (!data?.steps) {
        setError('Invalid tour data')
        return
      }
      setTourData(data)

      // T063: restore progress from localStorage
      const savedStep = loadProgress(workspace!.extensionId, tourId)
      const clampedStep = Math.min(savedStep, data.steps.length - 1)
      setCurrentStep(clampedStep >= 0 ? clampedStep : 0)
    } catch (err) {
      setError('Tour not found')
      console.error('[TourDetailPage] loadTour error:', err)
    } finally {
      setLoadingTour(false)
    }
  }

  // Load step code — use tour.getFileAtRef to read at recorded commit
  const loadStepCode = useCallback(
    async (step: TourStep, ref: string | null | undefined) => {
      if (!step.file) {
        setStepCode(null)
        return
      }
      try {
        setLoadingCode(true)
        const res = await request<{ ref: string | null; path: string }, TourGetFileAtRefResultPayload>(
          'tour.getFileAtRef',
          { ref: ref ?? null, path: step.file },
        )
        const snippet = extractLines(res.payload.content, step.line, step.endLine)
        setStepCode(snippet)
        setStepLanguage(res.payload.languageId || getLanguageFromFile(step.file))
      } catch {
        setStepCode(null)
      } finally {
        setLoadingCode(false)
      }
    },
    [request],
  )

  useEffect(() => {
    if (!tourData?.steps || tourData.steps.length === 0) return
    const step = tourData.steps[currentStep]
    if (step) loadStepCode(step, tourData.tour.ref)
  }, [tourData, currentStep, loadStepCode])

  // T063: save progress when step changes
  useEffect(() => {
    if (!workspace || !tourId || !tourData) return
    saveProgress(workspace.extensionId, tourId, currentStep)
  }, [currentStep, workspace, tourId, tourData])

  // Parse description into sections for editing
  function parseDescription(desc: string): { title: string; content: string }[] {
    const parts = desc.split(/^## /m).filter(Boolean)
    if (parts.length === 0) return [{ title: '', content: desc }]
    return parts.map(part => {
      const newlineIndex = part.indexOf('\n')
      if (newlineIndex === -1) return { title: part.trim(), content: '' }
      return { title: part.slice(0, newlineIndex).trim(), content: part.slice(newlineIndex + 1).trim() }
    })
  }

  function startEditStep() {
    if (!tourData) return
    const step = tourData.steps[currentStep]
    if (!step) return
    setEditSections(parseDescription(step.description))
    setEditingStep(true)
  }

  function buildDescription(sections: { title: string; content: string }[]): string {
    return sections
      .map(s => {
        const title = s.title.trim()
        const content = s.content.trim()
        if (title && content) return `## ${title}\n${content}`
        if (title) return `## ${title}`
        if (content) return content
        return ''
      })
      .filter(Boolean)
      .join('\n\n')
  }

  async function handleSaveEdit() {
    if (!tourData) return
    const step = tourData.steps[currentStep]
    if (!step) return
    const description = buildDescription(editSections)
    if (!description) return

    try {
      setSavingEdit(true)
      // Delete old step, re-add with new description at same index
      await request<{ tourId: string; stepIndex: number }, TourDeleteStepResultPayload>(
        'tour.deleteStep', { tourId, stepIndex: currentStep },
      )
      const addPayload: Record<string, unknown> = {
        tourId,
        description,
        index: currentStep,
      }
      if (step.file) {
        addPayload.file = step.file
        addPayload.line = step.line
        if (step.endLine != null) addPayload.endLine = step.endLine
      }
      await request<Record<string, unknown>, TourAddStepResultPayload>(
        'tour.addStep', addPayload,
      )
      setEditingStep(false)
      await loadTour()
    } catch (err) {
      console.error('[TourDetailPage] edit error:', err)
      setError('Failed to update step')
      setEditingStep(false)
    } finally {
      setSavingEdit(false)
    }
  }

  async function handleDeleteStep() {
    if (!tourData) return
    try {
      setDeleting(true)
      await request<{ tourId: string; stepIndex: number }, TourDeleteStepResultPayload>(
        'tour.deleteStep', { tourId, stepIndex: currentStep },
      )
      setConfirmDelete(false)
      // Adjust current step if needed
      const stepCount = tourData.steps?.length ?? 0
      if (stepCount <= 1) {
        navigate('/tours')
        return
      }
      if (currentStep >= stepCount - 1) {
        setCurrentStep(prev => Math.max(0, prev - 1))
      }
      await loadTour()
    } catch (err) {
      console.error('[TourDetailPage] delete error:', err)
      setError('Failed to delete step')
      setConfirmDelete(false)
    } finally {
      setDeleting(false)
    }
  }

  // Add steps entry point: set reference point after current step
  function handleAddStepsHere() {
    if (!tourData || !workspace) return
    setTourEdit({
      tourId,
      tourTitle: tourData.tour.title,
      extensionId: workspace.extensionId,
      afterIndex: currentStep,
    })
    navigate('/files')
  }

  function goTo(index: number) {
    if (!tourData) return
    const clamped = Math.max(0, Math.min(index, tourData.steps.length - 1))
    setCurrentStep(clamped)
  }

  if (!workspace) {
    return <div style={{ padding: 16, color: '#888' }}>No workspace selected</div>
  }

  if (loadingTour) {
    return <div style={{ padding: 16, color: '#888' }}>Loading tour...</div>
  }

  if (error || !tourData) {
    return <div style={{ padding: 16, color: '#f48771' }}>{error ?? 'Tour not found'}</div>
  }

  const steps = tourData.steps ?? []

  // Empty tour: show prompt to add steps
  if (steps.length === 0) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ padding: '10px 12px', borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <button onClick={() => navigate('/tours')} style={{ background: 'none', border: 'none', color: '#569cd6', fontSize: 14, cursor: 'pointer', padding: '2px 6px 2px 0' }}>
            ← Tours
          </button>
          <span style={{ fontSize: 15, fontWeight: 600, color: '#d4d4d4', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {tourData.tour.title}
          </span>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 }}>
          <div style={{ fontSize: 15, color: '#888' }}>This tour has no steps yet</div>
          <button
            onClick={() => {
              if (!workspace) return
              setTourEdit({
                tourId,
                tourTitle: tourData.tour.title,
                extensionId: workspace.extensionId,
                afterIndex: -1,
              })
              navigate('/files')
            }}
            style={{ background: '#569cd6', border: 'none', color: '#fff', fontSize: 14, padding: '10px 24px', borderRadius: 6, cursor: 'pointer' }}
          >
            + Add Steps
          </button>
        </div>
      </div>
    )
  }

  const step = steps[currentStep]
  const isFirst = currentStep === 0
  const isLast = currentStep === steps.length - 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div
        style={{
          padding: '10px 12px',
          borderBottom: '1px solid #333',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
        }}
      >
        <button
          onClick={() => navigate('/tours')}
          style={{
            background: 'none',
            border: 'none',
            color: '#569cd6',
            fontSize: 14,
            cursor: 'pointer',
            padding: '2px 6px 2px 0',
          }}
        >
          ← Tours
        </button>
        <span style={{ fontSize: 15, fontWeight: 600, color: '#d4d4d4', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {tourData.tour.title}
        </span>
        <span style={{ fontSize: 12, color: '#888', flexShrink: 0 }}>
          {currentStep + 1} / {steps.length}
        </span>
      </div>

      {/* Step content — scrollable */}
      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'] }}>
        {/* Step title */}
        {step.title && (
          <div style={{ padding: '12px 16px 0', fontSize: 14, fontWeight: 600, color: '#d4d4d4' }}>
            {step.title}
          </div>
        )}

        {/* Description — full markdown rendering */}
        <div style={{ padding: '0 4px' }}>
          <MarkdownRenderer content={step.description} />
        </div>

        {/* File + line info + T062: "View in Code Viewer" link */}
        {step.file && (
          <div
            style={{
              padding: '4px 16px 10px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: 12, color: '#888', fontFamily: "'JetBrains Mono', monospace" }}>
              {step.file}:{step.line}
              {step.endLine !== undefined && step.endLine !== step.line ? `–${step.endLine}` : ''}
            </span>
            <button
              onClick={() => navigate(`/files/${encodeURIComponent(step.file)}`, { state: { scrollToLine: step.line - 1 } })}
              style={{
                background: 'none',
                border: '1px solid #444',
                borderRadius: 4,
                color: '#569cd6',
                fontSize: 12,
                cursor: 'pointer',
                padding: '2px 8px',
              }}
            >
              View in Code Viewer
            </button>
          </div>
        )}

        {/* Code snippet */}
        {step.file && (
          <div style={{ margin: '0 0 16px' }}>
            {loadingCode ? (
              <div style={{ padding: '8px 16px', color: '#888', fontSize: 13 }}>Loading code...</div>
            ) : stepCode !== null ? (
              <CodeBlock
                code={stepCode}
                language={stepLanguage}
                showLineNumbers
                startLine={step.line}
                selectionHighlight={step.selection ?? null}
              />
            ) : (
              <div style={{ padding: '8px 16px', color: '#888', fontSize: 13 }}>Could not load code snippet</div>
            )}
          </div>
        )}

        {/* Step actions: Edit / Delete / Add steps here */}
        <div style={{ padding: '0 16px 16px', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={startEditStep} style={actionBtnStyle}>
            Edit
          </button>
          <button onClick={() => setConfirmDelete(true)} style={{ ...actionBtnStyle, color: '#f48771', borderColor: '#5a3030' }}>
            Delete
          </button>
          <button onClick={handleAddStepsHere} style={{ ...actionBtnStyle, color: '#569cd6', borderColor: '#264f78' }}>
            + Add step after
          </button>
        </div>

        {/* Delete confirmation */}
        {confirmDelete && (
          <div style={{ padding: '0 16px 16px' }}>
            <div style={{ background: '#2a2020', border: '1px solid #5a3030', borderRadius: 6, padding: 12 }}>
              <div style={{ fontSize: 13, color: '#f48771', marginBottom: 8 }}>Delete this step?</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={handleDeleteStep}
                  disabled={deleting}
                  style={{ ...actionBtnStyle, background: '#5a3030', color: '#f48771', borderColor: '#5a3030' }}
                >
                  {deleting ? '...' : 'Yes, delete'}
                </button>
                <button onClick={() => setConfirmDelete(false)} style={actionBtnStyle}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Navigation footer */}
      <div
        style={{
          padding: '10px 16px',
          borderTop: '1px solid #333',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
          gap: 8,
        }}
      >
        <button
          onClick={() => goTo(currentStep - 1)}
          disabled={isFirst}
          style={{
            padding: '8px 20px',
            background: isFirst ? '#2a2a2a' : '#264f78',
            border: 'none',
            borderRadius: 6,
            color: isFirst ? '#555' : '#d4d4d4',
            fontSize: 14,
            cursor: isFirst ? 'default' : 'pointer',
            minWidth: 80,
          }}
        >
          Prev
        </button>

        {/* Step dots */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center', flex: 1 }}>
          {steps.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                border: 'none',
                background: i === currentStep ? '#569cd6' : '#444',
                cursor: 'pointer',
                padding: 0,
              }}
              aria-label={`Go to step ${i + 1}`}
            />
          ))}
        </div>

        <button
          onClick={() => goTo(currentStep + 1)}
          disabled={isLast}
          style={{
            padding: '8px 20px',
            background: isLast ? '#2a2a2a' : '#264f78',
            border: 'none',
            borderRadius: 6,
            color: isLast ? '#555' : '#d4d4d4',
            fontSize: 14,
            cursor: isLast ? 'default' : 'pointer',
            minWidth: 80,
          }}
        >
          Next
        </button>
      </div>

      {/* Edit step overlay */}
      {editingStep && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: '#1e1e1e',
          zIndex: 200,
          display: 'flex',
          flexDirection: 'column',
        }}>
          <div style={{
            padding: '10px 16px',
            paddingTop: 'calc(10px + env(safe-area-inset-top))',
            borderBottom: '1px solid #333',
            flexShrink: 0,
          }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#d4d4d4' }}>Edit Step Description</div>
            {step.file && (
              <div style={{ fontSize: 12, color: '#888', marginTop: 4, fontFamily: "'JetBrains Mono', monospace" }}>
                {step.file}:{step.line}{step.endLine !== undefined && step.endLine !== step.line ? `–${step.endLine}` : ''}
              </div>
            )}
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: 16, WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'] }}>
            {editSections.map((section, i) => (
              <div key={i} style={{ marginBottom: 16, border: '1px solid #333', borderRadius: 6, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', background: '#252526', padding: '6px 10px' }}>
                  <span style={{ fontSize: 12, color: '#888', flex: 1 }}>Section {i + 1}</span>
                  {editSections.length > 1 && (
                    <button
                      onClick={() => setEditSections(prev => prev.filter((_, j) => j !== i))}
                      style={{ background: 'none', border: 'none', color: '#f48771', fontSize: 14, cursor: 'pointer', padding: '0 4px' }}
                    >
                      &#x1F5D1;
                    </button>
                  )}
                </div>
                <input
                  placeholder="Title (## heading)"
                  value={section.title}
                  onChange={(e) => setEditSections(prev => prev.map((s, j) => j === i ? { ...s, title: e.target.value } : s))}
                  style={editInputStyle}
                />
                <textarea
                  placeholder="Content..."
                  value={section.content}
                  onChange={(e) => setEditSections(prev => prev.map((s, j) => j === i ? { ...s, content: e.target.value } : s))}
                  rows={4}
                  style={{ ...editInputStyle, resize: 'vertical', minHeight: 80 }}
                />
              </div>
            ))}
            <button
              onClick={() => setEditSections(prev => [...prev, { title: '', content: '' }])}
              style={{ display: 'block', width: '100%', padding: 10, background: 'none', border: '1px dashed #444', borderRadius: 6, color: '#888', fontSize: 13, cursor: 'pointer' }}
            >
              + Add Section
            </button>
          </div>
          <div style={{
            padding: '10px 16px',
            paddingBottom: 'calc(10px + env(safe-area-inset-bottom))',
            borderTop: '1px solid #333',
            display: 'flex',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}>
            <button
              onClick={() => setEditingStep(false)}
              style={{ background: 'none', border: '1px solid #444', color: '#888', fontSize: 14, padding: '8px 20px', borderRadius: 6, cursor: 'pointer' }}
            >
              Cancel
            </button>
            <button
              onClick={handleSaveEdit}
              disabled={savingEdit}
              style={{ background: '#569cd6', border: 'none', color: '#fff', fontSize: 14, padding: '8px 20px', borderRadius: 6, cursor: savingEdit ? 'default' : 'pointer', opacity: savingEdit ? 0.5 : 1 }}
            >
              {savingEdit ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const actionBtnStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid #444',
  color: '#888',
  fontSize: 12,
  padding: '4px 12px',
  borderRadius: 4,
  cursor: 'pointer',
}

const editInputStyle: React.CSSProperties = {
  background: '#2a2a2a',
  border: 'none',
  borderBottom: '1px solid #333',
  color: '#d4d4d4',
  fontSize: 14,
  padding: '8px 10px',
  outline: 'none',
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
}
