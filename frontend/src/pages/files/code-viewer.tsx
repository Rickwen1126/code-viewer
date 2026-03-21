import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router'
import { useWebSocket } from '../../hooks/use-websocket'
import { wsClient } from '../../services/ws-client'
import { cacheService } from '../../services/cache'
import { useWorkspace } from '../../hooks/use-workspace'
import { CodeBlock } from '../../components/code-block'
import { ActionSheet } from '../../components/action-sheet'
import { ReferencesList } from '../../components/references-list'
import { SymbolOutline } from '../../components/symbol-outline'
import type {
  FileReadResultPayload,
  LspHoverResultPayload,
  LspDefinitionResultPayload,
  LspReferencesResultPayload,
  LspDocumentSymbolResultPayload,
} from '@code-viewer/shared'

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const LINE_HEIGHT = 19.5 // 13px * 1.5
const CHAR_WIDTH = 7.8 // 13px * 0.6
const LONG_PRESS_DURATION = 500 // ms
const TAP_MAX_DURATION = 300 // ms

interface TouchPos {
  line: number
  character: number
}

export function CodeViewerPage() {
  const { '*': rawPath } = useParams()
  const path = rawPath ? decodeURIComponent(rawPath) : ''
  const navigate = useNavigate()
  const { request, connectionState } = useWebSocket()
  const { workspace } = useWorkspace()
  const [file, setFile] = useState<FileReadResultPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [tooLarge, setTooLarge] = useState(false)
  const [wordWrap, setWordWrap] = useState(false)

  // Hover tooltip state (T037)
  const [hoverTooltip, setHoverTooltip] = useState<{
    contents: string
    x: number
    y: number
  } | null>(null)

  // Action sheet state (T039)
  const [actionSheetOpen, setActionSheetOpen] = useState(false)
  const [pendingPos, setPendingPos] = useState<TouchPos | null>(null)

  // References list state (T041)
  const [referencesOpen, setReferencesOpen] = useState(false)
  const [references, setReferences] = useState<LspReferencesResultPayload['locations']>([])

  // Symbol outline state (T042)
  const [symbolsOpen, setSymbolsOpen] = useState(false)
  const [symbols, setSymbols] = useState<LspDocumentSymbolResultPayload['symbols']>([])

  // Touch tracking refs
  const touchStartRef = useRef<{ time: number; x: number; y: number } | null>(null)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const codeContainerRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!path) return
    loadFile()
    const unsub = wsClient.subscribe('file.contentChanged', (msg) => {
      const payload = msg.payload as { path: string }
      if (payload.path === path) loadFile()
    })
    return unsub
  }, [path, connectionState])

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
    }
  }, [])

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

  // Compute line/character from touch coordinates relative to code container
  function getTouchPosition(clientX: number, clientY: number): TouchPos {
    const container = codeContainerRef.current
    const scrollContainer = scrollContainerRef.current
    if (!container || !scrollContainer) return { line: 0, character: 0 }

    const rect = container.getBoundingClientRect()
    const scrollTop = scrollContainer.scrollTop
    const scrollLeft = scrollContainer.scrollLeft

    // Relative to top-left of code content (accounting for scroll)
    const relX = clientX - rect.left + scrollLeft
    const relY = clientY - rect.top + scrollTop

    const line = Math.max(0, Math.floor(relY / LINE_HEIGHT))
    const character = Math.max(0, Math.floor(relX / CHAR_WIDTH))

    return { line, character }
  }

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length !== 1) return
      const touch = e.touches[0]
      const startTime = Date.now()

      touchStartRef.current = { time: startTime, x: touch.clientX, y: touch.clientY }

      // Start long-press timer
      longPressTimerRef.current = setTimeout(() => {
        if (!touchStartRef.current) return
        const pos = getTouchPosition(
          touchStartRef.current.x,
          touchStartRef.current.y,
        )
        setPendingPos(pos)
        setActionSheetOpen(true)
        touchStartRef.current = null
      }, LONG_PRESS_DURATION)
    },
    [],
  )

  const handleTouchEnd = useCallback(
    async (e: React.TouchEvent) => {
      // Cancel long-press timer
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current)
        longPressTimerRef.current = null
      }

      if (!touchStartRef.current) return

      const duration = Date.now() - touchStartRef.current.time
      const startX = touchStartRef.current.x
      const startY = touchStartRef.current.y
      touchStartRef.current = null

      // Only treat as tap if short duration
      if (duration > TAP_MAX_DURATION) return

      // Guard: don't attempt LSP calls when not connected
      if (connectionState !== 'connected') return

      // Use changedTouches for touchend
      const touch = e.changedTouches[0]
      const dx = touch.clientX - startX
      const dy = touch.clientY - startY

      // Ignore if finger moved significantly (scroll)
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) return

      // Tap: send hover request (T037)
      const pos = getTouchPosition(touch.clientX, touch.clientY)

      try {
        const res = await request<
          { path: string; line: number; character: number },
          LspHoverResultPayload
        >('lsp.hover', { path, line: pos.line, character: pos.character })

        if (res.payload && res.payload.contents) {
          // Position tooltip near tap point but keep within viewport
          const vpWidth = window.innerWidth
          const tooltipX = Math.min(touch.clientX, vpWidth - 220)
          const tooltipY = Math.max(0, touch.clientY - 80)

          setHoverTooltip({
            contents: res.payload.contents,
            x: tooltipX,
            y: tooltipY,
          })
          // Auto-dismiss after 4 seconds
          setTimeout(() => setHoverTooltip(null), 4000)
        }
      } catch {
        // Ignore hover errors silently
      }
    },
    [path, request, connectionState],
  )

  const handleTouchMove = useCallback(() => {
    // Cancel long-press if finger moves
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }, [])

  // Navigate to a file at a given line
  function navigateToFile(targetPath: string, line: number) {
    // Encode the path for the URL
    const encoded = targetPath.split('/').map(encodeURIComponent).join('/')
    navigate(`/files/${encoded}`, { state: { scrollToLine: line } })
  }

  // Scroll the current file to a given line
  function scrollToLine(line: number) {
    const scrollContainer = scrollContainerRef.current
    if (!scrollContainer) return
    const targetScrollTop = line * LINE_HEIGHT
    scrollContainer.scrollTo({ top: targetScrollTop, behavior: 'smooth' })
  }

  // Go to Definition handler (T040)
  async function handleGoToDefinition() {
    if (!pendingPos) return
    try {
      const res = await request<
        { path: string; line: number; character: number },
        LspDefinitionResultPayload
      >('lsp.definition', { path, line: pendingPos.line, character: pendingPos.character })

      const locations = res.payload?.locations ?? []
      if (locations.length === 0) return

      const loc = locations[0]
      if (loc.path === path) {
        // Same file — just scroll
        scrollToLine(loc.range.start.line)
      } else {
        navigateToFile(loc.path, loc.range.start.line)
      }
    } catch {
      // Ignore
    }
  }

  // Find References handler (T041)
  async function handleFindReferences() {
    if (!pendingPos) return
    try {
      const res = await request<
        { path: string; line: number; character: number; includeDeclaration: boolean },
        LspReferencesResultPayload
      >('lsp.references', {
        path,
        line: pendingPos.line,
        character: pendingPos.character,
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
        {/* Wrap toggle + Symbols */}
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

      {/* Code with touch handlers */}
      <div
        ref={scrollContainerRef}
        style={{ flex: 1, overflow: 'auto', WebkitOverflowScrolling: 'touch', position: 'relative' }}
        onClick={() => setHoverTooltip(null)}
      >
        <div
          ref={codeContainerRef}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          onTouchMove={handleTouchMove}
        >
          <CodeBlock code={file.content} language={file.languageId} showLineNumbers wordWrap={wordWrap} />
        </div>
      </div>

      {/* Hover tooltip (T037) */}
      {hoverTooltip && (
        <div
          onClick={() => setHoverTooltip(null)}
          style={{
            position: 'fixed',
            left: hoverTooltip.x,
            top: hoverTooltip.y,
            maxWidth: 280,
            background: '#1e1e1e',
            border: '1px solid #444',
            borderRadius: 6,
            padding: '8px 10px',
            fontSize: 12,
            color: '#d4d4d4',
            fontFamily: "'JetBrains Mono', monospace",
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            zIndex: 50,
            boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
            lineHeight: 1.5,
          }}
        >
          {hoverTooltip.contents}
        </div>
      )}

      {/* Action sheet (T039) */}
      <ActionSheet
        isOpen={actionSheetOpen}
        onClose={() => setActionSheetOpen(false)}
        actions={[
          {
            label: 'Go to Definition',
            onClick: handleGoToDefinition,
          },
          {
            label: 'Find References',
            onClick: handleFindReferences,
          },
          {
            label: 'Document Symbols',
            onClick: handleDocumentSymbols,
          },
        ]}
      />

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
