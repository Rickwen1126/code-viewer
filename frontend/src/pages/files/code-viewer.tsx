import { useState, useEffect, useRef } from 'react'
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
  const { request, connectionState } = useWebSocket()
  const { workspace } = useWorkspace()
  const [file, setFile] = useState<FileReadResultPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [tooLarge, setTooLarge] = useState(false)
  const [wordWrap, setWordWrap] = useState(false)

  // Action sheet state (T039)
  const [actionSheetOpen, setActionSheetOpen] = useState(false)

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
    loadFile()
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

  // Get line/character from current text selection (works with native mobile selection)
  function getPositionFromSelection(): TouchPos | null {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return null

    const range = sel.getRangeAt(0)
    const container = codeContainerRef.current
    if (!container || !container.contains(range.startContainer)) return null

    // Walk up from the selection to find which .line span we're in
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

    // Find line index by counting .line siblings
    const lines = container.querySelectorAll('.line')
    let lineIndex = 0
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === lineEl) { lineIndex = i; break }
    }

    // Character offset: use range's offset within the line text
    const lineRange = document.createRange()
    lineRange.selectNodeContents(lineEl)
    lineRange.setEnd(range.startContainer, range.startOffset)
    const character = lineRange.toString().length

    return { line: lineIndex, character }
  }

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

  // Go to Definition handler (T040) — uses current text selection position
  async function handleGoToDefinition() {
    const pos = getPositionFromSelection()
    if (!pos) return
    setActionSheetOpen(false)
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

  // Find References handler (T041) — uses current text selection position
  async function handleFindReferences() {
    const pos = getPositionFromSelection()
    if (!pos) return
    setActionSheetOpen(false)
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
            onClick={() => setActionSheetOpen(true)}
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
            Actions
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

      {/* Code area — native selection works, no custom touch handlers */}
      <div
        ref={scrollContainerRef}
        style={{ flex: 1, overflow: 'auto', WebkitOverflowScrolling: 'touch', position: 'relative' }}
      >
        <div ref={codeContainerRef}>
          <CodeBlock code={file.content} language={file.languageId} showLineNumbers wordWrap={wordWrap} />
        </div>
      </div>

      {/* Action sheet (T039) — triggered by header Actions button */}
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
