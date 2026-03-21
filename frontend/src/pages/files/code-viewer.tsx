import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router'
import { useWebSocket } from '../../hooks/use-websocket'
import { wsClient } from '../../services/ws-client'
import { cacheService } from '../../services/cache'
import { useWorkspace } from '../../hooks/use-workspace'
import { CodeBlock } from '../../components/code-block'
import { ReferencesList } from '../../components/references-list'
import { SymbolOutline } from '../../components/symbol-outline'
import type {
  FileReadResultPayload,
  LspDefinitionResultPayload,
  LspReferencesResultPayload,
  LspDocumentSymbolResultPayload,
} from '@code-viewer/shared'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const LINE_HEIGHT = 19.5 // 13px * 1.5

interface TouchPos {
  line: number
  character: number
}

export function CodeViewerPage() {
  const { '*': rawPath } = useParams()
  const path = rawPath ? decodeURIComponent(rawPath) : ''
  const navigate = useNavigate()
  const location = useLocation()
  const { request, connectionState } = useWebSocket()
  const { workspace } = useWorkspace()
  const [file, setFile] = useState<FileReadResultPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [tooLarge, setTooLarge] = useState(false)
  const [wordWrap, setWordWrap] = useState(false)
  const [highlightLine, setHighlightLine] = useState<number | null>(null)

  // References list state (T041)
  const [referencesOpen, setReferencesOpen] = useState(false)
  const [references, setReferences] = useState<LspReferencesResultPayload['locations']>([])

  // Symbol outline state (T042)
  const [symbolsOpen, setSymbolsOpen] = useState(false)
  const [symbols, setSymbols] = useState<LspDocumentSymbolResultPayload['symbols']>([])

  const codeContainerRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Redirect to workspace selection if no workspace chosen
  useEffect(() => {
    if (!workspace && connectionState === 'connected') {
      navigate('/workspaces', { replace: true })
    }
  }, [workspace, connectionState, navigate])

  useEffect(() => {
    if (!path || !workspace) return
    loadFile().then(() => {
      // After file loads, scroll to target line if navigated via Go to Definition
      const state = location.state as { scrollToLine?: number } | null
      if (state?.scrollToLine != null) {
        setTimeout(() => scrollToLine(state.scrollToLine!), 100)
      }
    })
    const unsub = wsClient.subscribe('file.contentChanged', (msg) => {
      const payload = msg.payload as { path: string }
      if (payload.path === path) loadFile()
    })
    return unsub
  }, [path, connectionState])

  async function loadFile() {
    if (!path) return
    try {
      setLoading(true)
      setTooLarge(false)
      const res = await request<{ path: string }, FileReadResultPayload>('file.read', { path })

      // Check if content is too large
      if (res.payload.content && res.payload.content.length > MAX_FILE_SIZE) {
        setTooLarge(true)
        setFile(null)
      } else {
        setFile(res.payload)
        // Cache the file
        if (workspace) {
          cacheService.setFileContent(workspace.extensionId, path, {
            path: res.payload.path,
            content: res.payload.content,
            languageId: res.payload.languageId,
            isDirty: res.payload.isDirty,
            encoding: res.payload.encoding,
            lineCount: res.payload.lineCount,
          })
        }
      }
    } catch {
      // Try cache
      if (workspace) {
        const cached = await cacheService.getFileContent(workspace.extensionId, path)
        if (cached) {
          setFile({
            path: cached.path,
            content: cached.content,
            languageId: cached.languageId,
            isDirty: cached.isDirty,
            encoding: cached.encoding,
            lineCount: cached.lineCount,
          })
        }
      }
    } finally {
      setLoading(false)
    }
  }

  // Code popover state: shown on tap, contains hover info + action buttons
  const [popover, setPopover] = useState<{
    pos: TouchPos
    x: number
    y: number
    hoverContent: string | null
    loading: boolean
  } | null>(null)

  // Get line/character from click coordinates using caretRangeFromPoint
  function getPositionFromClick(clientX: number, clientY: number): TouchPos | null {
    const container = codeContainerRef.current
    if (!container) return null

    // Use caretRangeFromPoint to find exact text position
    const range = document.caretRangeFromPoint(clientX, clientY)
    if (!range || !container.contains(range.startContainer)) return null

    // Walk up to find .line element
    let node: Node | null = range.startContainer
    let lineEl: HTMLElement | null = null
    while (node && node !== container) {
      if (node instanceof HTMLElement && node.classList?.contains('line')) {
        lineEl = node
        break
      }
      node = node.parentNode
    }
    if (!lineEl) return null

    // Find line index
    const lines = container.querySelectorAll('.line')
    let lineIndex = 0
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === lineEl) { lineIndex = i; break }
    }

    // Character offset within line
    const lineRange = document.createRange()
    lineRange.selectNodeContents(lineEl)
    lineRange.setEnd(range.startContainer, range.startOffset)
    const character = lineRange.toString().length

    return { line: lineIndex, character }
  }

  // Handle tap on code: show popover with hover info + actions
  function handleCodeClick(e: React.MouseEvent) {
    // Ignore if user is selecting text (has active selection)
    const sel = window.getSelection()
    if (sel && sel.toString().length > 0) return

    const pos = getPositionFromClick(e.clientX, e.clientY)
    if (!pos) return

    // Position popover near tap point
    const vpWidth = window.innerWidth
    const x = Math.min(e.clientX, vpWidth - 240)
    const y = Math.max(0, e.clientY - 60)

    setPopover({ pos, x, y, hoverContent: null, loading: true })

    // Fetch hover info
    if (connectionState === 'connected') {
      request<{ path: string; line: number; character: number }, { contents: string } | null>(
        'lsp.hover', { path, line: pos.line, character: pos.character }
      ).then(res => {
        setPopover(prev => prev ? { ...prev, hoverContent: res.payload?.contents ?? null, loading: false } : null)
      }).catch(() => {
        setPopover(prev => prev ? { ...prev, loading: false } : null)
      })
    } else {
      setPopover(prev => prev ? { ...prev, loading: false } : null)
    }
  }

  // Navigate to a file at a given line
  function navigateToFile(targetPath: string, line: number) {
    // Encode the path for the URL
    const encoded = targetPath.split('/').map(encodeURIComponent).join('/')
    navigate(`/files/${encoded}`, { state: { scrollToLine: line } })
  }

  // Scroll to a line and briefly highlight it
  function scrollToLine(line: number) {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) return
    const targetScrollTop = line * LINE_HEIGHT
    scrollContainer.scrollTo({ top: targetScrollTop, behavior: 'smooth' })
    setHighlightLine(line)
    setTimeout(() => setHighlightLine(null), 3500)
  }

  // Go to Definition handler (T040) — uses popover position from tap
  async function handleGoToDefinition() {
    if (!popover) return
    const { pos } = popover
    setPopover(null)
    try {
      const res = await request<
        { path: string; line: number; character: number },
        LspDefinitionResultPayload
      >('lsp.definition', { path, line: pos.line, character: pos.character })

      const locations = res.payload?.locations ?? []
      if (locations.length === 0) return

      const loc = locations[0]
      if (loc.path === path) {
        scrollToLine(loc.range.start.line)
      } else {
        navigateToFile(loc.path, loc.range.start.line)
      }
    } catch {
      // Ignore
    }
  }

  // Find References handler (T041) — uses popover position from tap
  async function handleFindReferences() {
    if (!popover) return
    const { pos } = popover
    setPopover(null)
    try {
      const res = await request<
        { path: string; line: number; character: number; includeDeclaration: boolean },
        LspReferencesResultPayload
      >('lsp.references', {
        path,
        line: pos.line,
        character: pos.character,
        includeDeclaration: true,
      })

      setReferences(res.payload?.locations ?? [])
      setReferencesOpen(true)
    } catch {
      setReferences([])
      setReferencesOpen(true)
    }
  }

  // Document Symbols handler (T042)
  async function handleDocumentSymbols() {
    try {
      const res = await request<{ path: string }, LspDocumentSymbolResultPayload>(
        'lsp.documentSymbol',
        { path },
      )
      setSymbols(res.payload?.symbols ?? [])
      setSymbolsOpen(true)
    } catch {
      setSymbols([])
      setSymbolsOpen(true)
    }
  }

  const fileName = path.split('/').pop() ?? path

  if (loading) {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
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
          <span style={{ fontSize: 13, color: '#d4d4d4' }}>{fileName}</span>
        </div>
        <div style={{ flex: 1, padding: '12px 16px', display: 'flex', gap: 12 }}>
          {/* Line number gutter skeleton */}
          <div style={{ width: 28, flexShrink: 0 }}>
            {Array.from({ length: 20 }, (_, i) => (
              <div
                key={i}
                style={{
                  height: 12,
                  marginBottom: 7.5,
                  borderRadius: 2,
                  background: '#2a2a2a',
                  width: i < 9 ? 8 : 16,
                  marginLeft: 'auto',
                }}
              />
            ))}
          </div>
          {/* Code lines skeleton */}
          <div style={{ flex: 1 }}>
            {[65, 40, 80, 55, 30, 70, 45, 90, 35, 60, 25, 75, 50, 85, 20, 70, 40, 55, 30, 65].map(
              (w, i) => (
                <div
                  key={i}
                  style={{
                    height: 12,
                    marginBottom: 7.5,
                    borderRadius: 2,
                    background: '#2a2a2a',
                    width: `${w}%`,
                    animation: 'skeleton-pulse 1.5s ease-in-out infinite',
                    animationDelay: `${i * 50}ms`,
                  }}
                />
              ),
            )}
          </div>
        </div>
        <style>{`
          @keyframes skeleton-pulse {
            0%, 100% { opacity: 0.4; }
            50% { opacity: 0.8; }
          }
        `}</style>
      </div>
    )
  }

  if (tooLarge) {
    return (
      <div style={{ padding: 16, textAlign: 'center', paddingTop: 60 }}>
        <div style={{ fontSize: 16, color: '#d4d4d4', marginBottom: 8 }}>{fileName}</div>
        <div style={{ fontSize: 14, color: '#888', marginBottom: 16 }}>File too large (&gt;5MB)</div>
        <div style={{ fontSize: 13, color: '#569cd6' }}>Please view in Desktop VS Code</div>
      </div>
    )
  }

  if (!file) {
    return <div style={{ padding: 16, color: '#888' }}>File not found</div>
  }

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
        <span style={{ fontSize: 13, color: '#d4d4d4' }}>{fileName}</span>
        <span style={{ fontSize: 11, color: '#888' }}>{file.languageId}</span>
        {file.isDirty && (
          <span
            style={{
              fontSize: 10,
              color: '#e2b93d',
              background: '#3c3c00',
              padding: '1px 6px',
              borderRadius: 4,
            }}
          >
            unsaved
          </span>
        )}
        {/* Wrap toggle + Actions + Symbols */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          <button
            onClick={() => setWordWrap((v) => !v)}
            style={{
              background: wordWrap ? '#333' : 'none',
              border: '1px solid #444',
              color: wordWrap ? '#d4d4d4' : '#888',
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Wrap
          </button>
          <button
            onClick={handleDocumentSymbols}
            style={{
              background: 'none',
              border: '1px solid #444',
              color: '#888',
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Symbols
          </button>
        </div>
      </div>

      {/* Code area — tap to show popover with hover + actions */}
      <div
        ref={scrollContainerRef}
        style={{ flex: 1, overflow: 'auto', WebkitOverflowScrolling: 'touch', position: 'relative' }}
        onClick={handleCodeClick}
      >
        <div ref={codeContainerRef}>
          <CodeBlock code={file.content} language={file.languageId} showLineNumbers wordWrap={wordWrap} highlightLine={highlightLine} />
        </div>
      </div>

      {/* Code popover: hover info + Go to Definition / Find References */}
      {popover && (
        <div
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            left: popover.x,
            top: popover.y,
            maxWidth: 280,
            background: '#252526',
            border: '1px solid #444',
            borderRadius: 8,
            padding: 0,
            fontSize: 12,
            color: '#d4d4d4',
            zIndex: 50,
            boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
            overflow: 'hidden',
          }}
        >
          {/* Hover content */}
          <div style={{
            padding: '8px 12px',
            fontFamily: "'JetBrains Mono', monospace",
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            lineHeight: 1.4,
            maxHeight: 120,
            overflow: 'auto',
            borderBottom: '1px solid #333',
            color: popover.loading ? '#888' : '#d4d4d4',
          }}>
            {popover.loading ? '...' : (popover.hoverContent || 'No type info')}
          </div>
          {/* Action buttons */}
          <div style={{ display: 'flex' }}>
            <button
              onClick={handleGoToDefinition}
              style={{
                flex: 1,
                padding: '10px 8px',
                background: 'none',
                border: 'none',
                borderRight: '1px solid #333',
                color: '#569cd6',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Definition
            </button>
            <button
              onClick={handleFindReferences}
              style={{
                flex: 1,
                padding: '10px 8px',
                background: 'none',
                border: 'none',
                color: '#569cd6',
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              References
            </button>
          </div>
        </div>
      )}

      {/* Dismiss popover on tap outside */}
      {popover && (
        <div
          onClick={() => setPopover(null)}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 49,
          }}
        />
      )}


      {/* References list (T041) */}
      <ReferencesList
        isOpen={referencesOpen}
        onClose={() => setReferencesOpen(false)}
        references={references}
        onNavigate={(targetPath, line) => {
          if (targetPath === path) {
            scrollToLine(line)
          } else {
            navigateToFile(targetPath, line)
          }
        }}
      />

      {/* Symbol outline (T042) */}
      <SymbolOutline
        isOpen={symbolsOpen}
        onClose={() => setSymbolsOpen(false)}
        symbols={symbols}
        onNavigate={scrollToLine}
      />
    </div>
  )
}
