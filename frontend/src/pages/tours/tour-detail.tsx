import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router'
import { useWebSocket } from '../../hooks/use-websocket'
import { useWorkspace } from '../../hooks/use-workspace'
import { CodeBlock } from '../../components/code-block'
import type { TourGetStepsResultPayload, FileReadResultPayload } from '@code-viewer/shared'

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

// Simple markdown renderer (bold, inline code, line breaks)
function renderDescription(text: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code
              key={i}
              style={{
                background: '#1e1e1e',
                border: '1px solid #444',
                borderRadius: 3,
                padding: '1px 4px',
                fontSize: 12,
                fontFamily: "'JetBrains Mono', monospace",
                color: '#ce9178',
              }}
            >
              {part.slice(1, -1)}
            </code>
          )
        }
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <strong key={i} style={{ color: '#d4d4d4' }}>
              {part.slice(2, -2)}
            </strong>
          )
        }
        return <span key={i}>{part}</span>
      })}
    </>
  )
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
      setTourData(res.payload)

      // T063: restore progress from localStorage
      const savedStep = loadProgress(workspace!.extensionId, tourId)
      const clampedStep = Math.min(savedStep, res.payload.steps.length - 1)
      setCurrentStep(clampedStep >= 0 ? clampedStep : 0)
    } catch (err) {
      setError('Tour not found')
      console.error('[TourDetailPage] loadTour error:', err)
    } finally {
      setLoadingTour(false)
    }
  }

  // Load step code whenever step changes
  const loadStepCode = useCallback(
    async (step: TourStep) => {
      if (!step.file) {
        setStepCode(null)
        return
      }
      try {
        setLoadingCode(true)
        const res = await request<{ path: string }, FileReadResultPayload>('file.read', { path: step.file })
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
    if (!tourData || tourData.steps.length === 0) return
    const step = tourData.steps[currentStep]
    if (step) loadStepCode(step)
  }, [tourData, currentStep, loadStepCode])

  // T063: save progress when step changes
  useEffect(() => {
    if (!workspace || !tourId || !tourData) return
    saveProgress(workspace.extensionId, tourId, currentStep)
  }, [currentStep, workspace, tourId, tourData])

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

  const steps = tourData.steps
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

        {/* Description */}
        <div style={{ padding: '10px 16px', fontSize: 14, color: '#b0b0b0', lineHeight: 1.6 }}>
          {renderDescription(step.description)}
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
              onClick={() => navigate(`/files/${encodeURIComponent(step.file)}`)}
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
              <CodeBlock code={stepCode} language={stepLanguage} />
            ) : (
              <div style={{ padding: '8px 16px', color: '#888', fontSize: 13 }}>Could not load code snippet</div>
            )}
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
    </div>
  )
}
