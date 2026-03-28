import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router'
import { useWebSocket } from '../../hooks/use-websocket'
import { wsClient } from '../../services/ws-client'
import { cacheService } from '../../services/cache'
import { useWorkspace } from '../../hooks/use-workspace'
import { CodeBlock } from '../../components/code-block'
import { MarkdownRenderer } from '../../components/markdown-renderer'
import { InFileSearch, type SearchMatch } from '../../components/in-file-search'
import { getBookmarkedLines, addBookmark, removeBookmark, getBookmarksForFile } from '../../services/bookmarks'
import { addRecentFile } from './file-browser'
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
  const [wordWrap, setWordWrap] = useState(() =>
    localStorage.getItem('code-viewer:wrap-enabled') === 'true',
  )
  const [highlightLine, setHighlightLine] = useState<number | null>(null)
  const [mdRendered, setMdRendered] = useState(() =>
    localStorage.getItem('code-viewer:md-view-mode') !== 'raw',
  )

  const isMarkdown = file?.languageId === 'markdown'

  // References list state (T041)
  const [referencesOpen, setReferencesOpen] = useState(false)
  const [references, setReferences] = useState<LspReferencesResultPayload['locations']>([])

  // Symbol outline state (T042)
  const [symbolsOpen, setSymbolsOpen] = useState(false)
  const [symbols, setSymbols] = useState<LspDocumentSymbolResultPayload['symbols']>([])

  // In-file search state
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([])
  const [searchCurrentIndex, setSearchCurrentIndex] = useState(-1)

  const handleSearchMatchesChange = useCallback((matches: SearchMatch[], currentIndex: number) => {
    setSearchMatches(matches)
    setSearchCurrentIndex(currentIndex)
    // Auto-scroll to current match
    if (matches.length > 0 && currentIndex >= 0) {
      const match = matches[currentIndex]
      const scrollContainer = scrollContainerRef.current
      if (scrollContainer) {
        const targetTop = match.line * LINE_HEIGHT
        const containerHeight = scrollContainer.clientHeight
        const currentScroll = scrollContainer.scrollTop
        // Only scroll if match is outside visible area
        if (targetTop < currentScroll || targetTop > currentScroll + containerHeight - 60) {
          scrollContainer.scrollTo({ top: Math.max(0, targetTop - containerHeight / 3), behavior: 'smooth' })
        }
      }
    }
  }, [])

  // Bookmarks state
  const [bookmarkedLines, setBookmarkedLines] = useState<Set<number>>(new Set())
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressTriggeredRef = useRef(false)

  // Load bookmarks when file changes
  useEffect(() => {
    if (!workspace || !path) return
    setBookmarkedLines(getBookmarkedLines(workspace.extensionId, path))
  }, [workspace, path])

  // Toggle bookmark at a given Y coordinate
  const toggleBookmarkAtY = useCallback((clientY: number) => {
    if (!workspace || !path || !file) return
    const container = codeContainerRef.current
    if (!container) return
    const lineEls = container.querySelectorAll('.line')
    let lineNum = 0
    for (let i = 0; i < lineEls.length; i++) {
      const rect = lineEls[i].getBoundingClientRect()
      if (clientY >= rect.top && clientY <= rect.bottom) {
        const dataLine = lineEls[i].getAttribute('data-line')
        if (dataLine) lineNum = parseInt(dataLine, 10)
        break
      }
    }
    if (!lineNum) return

    const contentLines = file.content.split('\n')
    const preview = contentLines[lineNum - 1] ?? ''

    if (bookmarkedLines.has(lineNum)) {
      removeBookmark(workspace.extensionId, path, lineNum)
      setBookmarkedLines(prev => { const next = new Set(prev); next.delete(lineNum); return next })
      showToast(`Bookmark removed (line ${lineNum})`)
    } else {
      addBookmark(workspace.extensionId, path, lineNum, preview)
      setBookmarkedLines(prev => new Set(prev).add(lineNum))
      showToast(`Bookmarked line ${lineNum}`)
    }
    if (navigator.vibrate) navigator.vibrate(50)
  }, [workspace, path, file, bookmarkedLines])

  // Long-press: start timer (touch + mouse)
  const startLongPress = useCallback((clientY: number) => {
    longPressTriggeredRef.current = false
    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true
      toggleBookmarkAtY(clientY)
    }, 400)
  }, [toggleBookmarkAtY])

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }, [])

  // Touch handlers
  const handleContentTouchStart = useCallback((e: React.TouchEvent) => {
    startLongPress(e.touches[0].clientY)
  }, [startLongPress])

  const handleContentTouchEnd = useCallback(() => cancelLongPress(), [cancelLongPress])
  const handleContentTouchMove = useCallback(() => cancelLongPress(), [cancelLongPress])

  // Mouse handlers (desktop)
  const handleContentMouseDown = useCallback((e: React.MouseEvent) => {
    startLongPress(e.clientY)
  }, [startLongPress])

  const handleContentMouseUp = useCallback(() => cancelLongPress(), [cancelLongPress])
  const handleContentMouseLeave = useCallback(() => cancelLongPress(), [cancelLongPress])

  // Toast state
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function showToast(msg: string) {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToastMsg(msg)
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 1500)
  }

  const codeContainerRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollRestoredRef = useRef('')

  // Persist current file path immediately on navigation
  useEffect(() => {
    if (path) {
      localStorage.setItem('code-viewer:current-file', path)
      if (workspace) localStorage.setItem(`code-viewer:current-file:${workspace.extensionId}`, path)
    }
  }, [path])

  // Redirect to workspace selection if no workspace ever selected
  useEffect(() => {
    if (!workspace && connectionState === 'connected') {
      navigate('/workspaces', { replace: true })
    }
  }, [workspace, connectionState, navigate])

  // Cache-first: immediately show cached file content
  useEffect(() => {
    if (!path || !workspace) return
    cacheService.getFileContent(workspace.extensionId, path).then(cached => {
      if (cached) {
        setFile(cached)
        setLoading(false)
        // Scroll to target line from cache too
        const state = location.state as { scrollToLine?: number } | null
        if (state?.scrollToLine != null) {
          setTimeout(() => scrollToLine(state.scrollToLine!), 100)
        }
      }
    })
  }, [path, workspace])

  // Background fetch on connect (no spinner if we have cached data)
  useEffect(() => {
    if (!path || !workspace || connectionState !== 'connected') return
    loadFileBackground().then(() => {
      const state = location.state as { scrollToLine?: number } | null
      if (state?.scrollToLine != null) {
        setTimeout(() => scrollToLine(state.scrollToLine!), 100)
      }
    })
    const unsub = wsClient.subscribe('file.contentChanged', (msg) => {
      const payload = msg.payload as { path: string }
      if (payload.path === path) loadFileBackground()
    })
    return unsub
  }, [path, connectionState])

  // Scroll position: debounced save
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container || !workspace || !path) return
    let timer: ReturnType<typeof setTimeout>
    const handler = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const key = `code-viewer:scroll:${workspace.extensionId}:${path}`
        localStorage.setItem(key, JSON.stringify({
          scrollTop: container.scrollTop,
          contentLength: file?.content?.length ?? 0,
          timestamp: Date.now(),
        }))
      }, 500)
    }
    container.addEventListener('scroll', handler, { passive: true })
    return () => { clearTimeout(timer); container.removeEventListener('scroll', handler) }
  }, [path, workspace, file])

  // Scroll position: restore once per path (after content renders)
  useEffect(() => {
    if (!file || !workspace || !scrollContainerRef.current) return
    if (scrollRestoredRef.current === path) return
    scrollRestoredRef.current = path

    // scrollToLine from navigation takes priority
    const state = location.state as { scrollToLine?: number } | null
    if (state?.scrollToLine != null) return

    const key = `code-viewer:scroll:${workspace.extensionId}:${path}`
    const saved = localStorage.getItem(key)
    if (!saved) return

    try {
      const { scrollTop, contentLength } = JSON.parse(saved)
      // Skip if content changed significantly
      if (contentLength && Math.abs(file.content.length - contentLength) / contentLength > 0.1) return
      requestAnimationFrame(() => {
        scrollContainerRef.current?.scrollTo({ top: scrollTop })
      })
    } catch { /* ignore */ }
  }, [file, path, workspace])

  // Cleanup: purge scroll entries older than 7 days (once on mount)
  useEffect(() => {
    const now = Date.now()
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (key?.startsWith('code-viewer:scroll:')) {
        try {
          const { timestamp } = JSON.parse(localStorage.getItem(key)!)
          if (now - timestamp > SEVEN_DAYS) localStorage.removeItem(key)
        } catch { localStorage.removeItem(key) }
      }
    }
  }, [])

  // Background load: silently update, no spinner
  async function loadFileBackground() {
    if (!path) return
    try {
      const res = await request<{ path: string }, FileReadResultPayload>('file.read', { path })
      if (res.payload.content && res.payload.content.length > MAX_FILE_SIZE) {
        setTooLarge(true)
        setFile(null)
      } else if (res.payload.content) {
        setFile(res.payload)
        addRecentFile(path)
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
      // If no data at all, try cache
      if (!file && workspace) {
        const cached = await cacheService.getFileContent(workspace.extensionId, path)
        if (cached) setFile(cached)
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

  if (loading && !file) {
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
      {/* Header — two rows: filename on top, buttons below */}
      <div style={{ padding: '6px 12px', borderBottom: '1px solid #333', flexShrink: 0 }}>
        {/* Row 1: filename */}
        <div style={{ fontSize: 13, color: '#d4d4d4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 4 }}>
          {fileName}
        </div>
        {/* Row 2: metadata + buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
          {bookmarkedLines.size > 0 && (
            <span style={{ fontSize: 11, color: '#e2b93d' }}>
              &#x2605;{bookmarkedLines.size}
            </span>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {isMarkdown && (
            <button
              onClick={() => setMdRendered((v) => {
                const next = !v
                localStorage.setItem('code-viewer:md-view-mode', next ? 'rendered' : 'raw')
                return next
              })}
              style={{
                background: mdRendered ? '#333' : 'none',
                border: '1px solid #444',
                color: mdRendered ? '#d4d4d4' : '#888',
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              {mdRendered ? 'Rendered' : 'Raw'}
            </button>
          )}
          <button
            onClick={() => setWordWrap((v) => {
              const next = !v
              localStorage.setItem('code-viewer:wrap-enabled', String(next))
              return next
            })}
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
          <button
            onClick={() => {
              // In rendered markdown mode, switch to raw for search
              if (isMarkdown && mdRendered) {
                setMdRendered(false)
                localStorage.setItem('code-viewer:md-view-mode', 'raw')
              }
              setSearchOpen(v => !v)
            }}
            style={{
              background: searchOpen ? '#333' : 'none',
              border: '1px solid #444',
              color: searchOpen ? '#d4d4d4' : '#888',
              fontSize: 13,
              padding: '2px 8px',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            &#x1F50D;
          </button>
          </div>
        </div>
      </div>

      {/* In-file search bar */}
      <InFileSearch
        content={file.content}
        visible={searchOpen}
        onClose={() => setSearchOpen(false)}
        onMatchesChange={handleSearchMatchesChange}
      />

      {/* Search highlight styles */}
      {searchMatches.length > 0 && (
        <style>{searchMatches.map((m, i) => `
          .line:nth-child(${m.line + 1}) { background: ${i === searchCurrentIndex ? 'rgba(226,185,61,0.25)' : 'rgba(226,185,61,0.1)'} !important; }
        `).join('')}</style>
      )}

      {/* Content area */}
      <div
        ref={scrollContainerRef}
        style={{ flex: 1, overflow: 'auto', WebkitOverflowScrolling: 'touch', position: 'relative' }}
        onClick={isMarkdown && mdRendered ? undefined : handleCodeClick}
        onTouchStart={handleContentTouchStart}
        onTouchEnd={handleContentTouchEnd}
        onTouchMove={handleContentTouchMove}
        onMouseDown={handleContentMouseDown}
        onMouseUp={handleContentMouseUp}
        onMouseLeave={handleContentMouseLeave}
      >
        {isMarkdown && mdRendered ? (
          <MarkdownRenderer content={file.content} />
        ) : (
          <div ref={codeContainerRef}>
            <CodeBlock code={file.content} language={file.languageId} showLineNumbers wordWrap={wordWrap} highlightLine={highlightLine} bookmarkedLines={bookmarkedLines} />
          </div>
        )}
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

      {/* Toast */}
      {toastMsg && (
        <div style={{
          position: 'fixed',
          bottom: 80,
          left: '50%',
          transform: 'translateX(-50%)',
          background: '#333',
          color: '#d4d4d4',
          padding: '8px 16px',
          borderRadius: 8,
          fontSize: 13,
          zIndex: 100,
          pointerEvents: 'none',
        }}>
          {toastMsg}
        </div>
      )}
    </div>
  )
}
