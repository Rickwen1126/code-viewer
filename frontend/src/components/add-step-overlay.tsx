import { useState } from 'react'
import { useWebSocket } from '../hooks/use-websocket'
import { useTourEdit } from '../hooks/use-tour-edit'
import type { TourAddStepResultPayload, LspDocumentSymbolResultPayload } from '@code-viewer/shared'

interface Section {
  title: string
  content: string
}

interface AddStepOverlayProps {
  file: string
  tappedLine: number
  onClose: () => void
  onSaved: () => void
}

export function AddStepOverlay({ file, tappedLine, onClose, onSaved }: AddStepOverlayProps) {
  const { request } = useWebSocket()
  const { tourEdit, advanceIndex } = useTourEdit()
  const [screen, setScreen] = useState<1 | 2>(1)
  const [startLine, setStartLine] = useState(tappedLine)
  const [endLineText, setEndLineText] = useState('') // empty = same as startLine
  const [sections, setSections] = useState<Section[]>([{ title: '', content: '' }])
  const [autoLoading, setAutoLoading] = useState(false)
  const [lineError, setLineError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!tourEdit) return null

  const effectiveEndLine = endLineText.trim() === '' ? startLine : Number(endLineText)

  function handleNext() {
    if (endLineText.trim() !== '' && (isNaN(effectiveEndLine) || effectiveEndLine < startLine)) {
      setLineError(`End line must be ≥ ${startLine}`)
      return
    }
    setLineError(null)
    setScreen(2)
  }

  async function handleAuto() {
    try {
      setAutoLoading(true)
      const res = await request<{ path: string }, LspDocumentSymbolResultPayload>(
        'lsp.documentSymbol', { path: file },
      )
      const symbols = res.payload?.symbols ?? []
      // Find the innermost symbol that contains startLine (0-indexed in LSP)
      const line0 = startLine - 1
      let bestEnd = -1
      function search(syms: typeof symbols) {
        for (const s of syms) {
          if (s.range.start.line <= line0 && s.range.end.line >= line0) {
            bestEnd = s.range.end.line + 1 // convert back to 1-indexed
            if (s.children) search(s.children)
          }
        }
      }
      search(symbols)
      if (bestEnd > 0) {
        setEndLineText(String(bestEnd))
      } else {
        setLineError('No enclosing symbol found')
      }
    } catch {
      setLineError('LSP unavailable')
    } finally {
      setAutoLoading(false)
    }
  }

  function updateSection(index: number, field: 'title' | 'content', value: string) {
    setSections(prev => prev.map((s, i) => i === index ? { ...s, [field]: value } : s))
  }

  function addSection() {
    setSections(prev => [...prev, { title: '', content: '' }])
  }

  function removeSection(index: number) {
    if (sections.length <= 1) return
    setSections(prev => prev.filter((_, i) => i !== index))
  }

  function buildDescription(): string {
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

  async function handleSave() {
    const description = buildDescription()
    if (!description) return
    try {
      setSaving(true)
      setError(null)
      await request<
        { tourId: string; file: string; line: number; endLine?: number; description: string; index?: number },
        TourAddStepResultPayload
      >('tour.addStep', {
        tourId: tourEdit!.tourId,
        file,
        line: startLine,
        endLine: effectiveEndLine !== startLine ? effectiveEndLine : undefined,
        description,
        index: tourEdit!.afterIndex + 1,
      })
      advanceIndex()
      onSaved()
    } catch (err) {
      console.error('[AddStepOverlay] save error:', err)
      setError('Failed to add step')
    } finally {
      setSaving(false)
    }
  }

  const fileName = file.split('/').pop() ?? file

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: '#1e1e1e',
      zIndex: 200,
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 16px',
        paddingTop: 'calc(10px + env(safe-area-inset-top))',
        borderBottom: '1px solid #333',
        flexShrink: 0,
      }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#d4d4d4' }}>
          Add Step to: {tourEdit.tourTitle}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' as React.CSSProperties['WebkitOverflowScrolling'] }}>
        {screen === 1 ? (
          /* Screen 1: Line range */
          <div style={{ padding: 16 }}>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 16 }}>
              File: <span style={{ color: '#d4d4d4', fontFamily: "'JetBrains Mono', monospace" }}>{fileName}</span>
            </div>

            <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 6 }}>Start line</label>
            <input
              type="number"
              value={startLine}
              onChange={(e) => setStartLine(Math.max(1, Number(e.target.value)))}
              style={inputStyle}
            />

            <label style={{ display: 'block', fontSize: 13, color: '#888', marginBottom: 6, marginTop: 16 }}>End line</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                inputMode="numeric"
                placeholder={String(startLine)}
                value={endLineText}
                onChange={(e) => { setEndLineText(e.target.value.replace(/[^0-9]/g, '')); setLineError(null) }}
                style={{ ...inputStyle, flex: 1 }}
              />
              <button
                onClick={handleAuto}
                disabled={autoLoading}
                style={{
                  background: '#333',
                  border: '1px solid #444',
                  color: autoLoading ? '#555' : '#569cd6',
                  fontSize: 12,
                  padding: '8px 12px',
                  borderRadius: 4,
                  cursor: autoLoading ? 'default' : 'pointer',
                  flexShrink: 0,
                }}
              >
                {autoLoading ? '...' : 'Auto'}
              </button>
            </div>
            {lineError && (
              <div style={{ marginTop: 6, color: '#f48771', fontSize: 12 }}>{lineError}</div>
            )}
          </div>
        ) : (
          /* Screen 2: Description editor */
          <div style={{ padding: 16 }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 16, fontFamily: "'JetBrains Mono', monospace" }}>
              {fileName}:{startLine}{effectiveEndLine !== startLine ? `–${effectiveEndLine}` : ''}
            </div>

            {sections.map((section, i) => (
              <div key={i} style={{ marginBottom: 16, border: '1px solid #333', borderRadius: 6, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', background: '#252526', padding: '6px 10px' }}>
                  <span style={{ fontSize: 12, color: '#888', flex: 1 }}>Section {i + 1}</span>
                  {sections.length > 1 && (
                    <button
                      onClick={() => removeSection(i)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#f48771',
                        fontSize: 14,
                        cursor: 'pointer',
                        padding: '0 4px',
                      }}
                    >
                      &#x1F5D1;
                    </button>
                  )}
                </div>
                <input
                  placeholder="Title (## heading)"
                  value={section.title}
                  onChange={(e) => updateSection(i, 'title', e.target.value)}
                  style={{
                    ...inputStyle,
                    borderRadius: 0,
                    border: 'none',
                    borderBottom: '1px solid #333',
                    width: '100%',
                  }}
                />
                <textarea
                  placeholder="Content..."
                  value={section.content}
                  onChange={(e) => updateSection(i, 'content', e.target.value)}
                  rows={4}
                  style={{
                    ...inputStyle,
                    borderRadius: 0,
                    border: 'none',
                    width: '100%',
                    resize: 'vertical',
                    minHeight: 80,
                  }}
                />
              </div>
            ))}

            <button
              onClick={addSection}
              style={{
                display: 'block',
                width: '100%',
                padding: '10px',
                background: 'none',
                border: '1px dashed #444',
                borderRadius: 6,
                color: '#888',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              + Add Section
            </button>

            {error && (
              <div style={{ marginTop: 12, color: '#f48771', fontSize: 13 }}>{error}</div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding: '10px 16px',
        paddingBottom: 'calc(10px + env(safe-area-inset-bottom))',
        borderTop: '1px solid #333',
        display: 'flex',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        {screen === 1 ? (
          <>
            <button onClick={onClose} style={secondaryBtnStyle}>Cancel</button>
            <button
              onClick={handleNext}
              style={primaryBtnStyle}
            >
              Next &rarr;
            </button>
          </>
        ) : (
          <>
            <button onClick={() => setScreen(1)} style={secondaryBtnStyle}>&larr; Back</button>
            <button
              onClick={handleSave}
              disabled={saving || !buildDescription()}
              style={{
                ...primaryBtnStyle,
                opacity: saving || !buildDescription() ? 0.5 : 1,
                cursor: saving ? 'default' : 'pointer',
              }}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  background: '#2a2a2a',
  border: '1px solid #444',
  borderRadius: 4,
  color: '#d4d4d4',
  fontSize: 14,
  padding: '8px 10px',
  outline: 'none',
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
}

const primaryBtnStyle: React.CSSProperties = {
  background: '#569cd6',
  border: 'none',
  color: '#fff',
  fontSize: 14,
  padding: '8px 20px',
  borderRadius: 6,
  cursor: 'pointer',
}

const secondaryBtnStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid #444',
  color: '#888',
  fontSize: 14,
  padding: '8px 20px',
  borderRadius: 6,
  cursor: 'pointer',
}
