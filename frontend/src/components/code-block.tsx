import ShikiHighlighter from 'react-shiki'
import { useState, useRef, useCallback, useMemo } from 'react'

interface SelectionRange {
  start: { line: number; character: number }
  end: { line: number; character: number }
}

interface CodeBlockProps {
  code: string
  language: string
  showLineNumbers?: boolean
  wordWrap?: boolean
  highlightLine?: number | null
  bookmarkedLines?: Set<number>
  onLineNumberClick?: (lineNum: number) => void
  /** Offset for line numbers (e.g., startLine=10 makes first line show as 10) */
  startLine?: number
  /** Highlight a selection range within the code */
  selectionHighlight?: SelectionRange | null
}

const MIN_FONT_SIZE = 8
const MAX_FONT_SIZE = 24
const DEFAULT_FONT_SIZE = 13

// Map VS Code languageId → Shiki language identifier
// Hard mismatches (Shiki doesn't accept VS Code's ID, not even as alias)
// Soft mismatches (dockerfile, coffeescript, makefile, jade, properties) are
// handled by Shiki's alias system and don't need explicit mapping.
const LANGUAGE_MAP: Record<string, string> = {
  // Hard mismatches
  typescriptreact: 'tsx',
  javascriptreact: 'jsx',
  restructuredtext: 'rst',
  wat: 'wasm',
  // VS Code internal IDs → plaintext
  'cuda-cpp': 'text',
  dockercompose: 'yaml',
  juliamarkdown: 'markdown',
  ignore: 'text',
  'search-result': 'text',
  'code-text-binary': 'text',
  chatagent: 'text',
  instructions: 'text',
  prompt: 'text',
  skill: 'text',
  snippets: 'json',
}

function mapLanguage(lang: string): string {
  return LANGUAGE_MAP[lang] ?? lang
}

// Shiki transformer factory: inject data-line + optional .bookmarked class
function createLineTransformer(bookmarked?: Set<number>) {
  return {
    line(node: { properties: Record<string, unknown> }, line: number) {
      node.properties['data-line'] = line
      if (bookmarked?.has(line)) {
        const existing = (node.properties['class'] as string) ?? ''
        node.properties['class'] = existing ? `${existing} bookmarked` : 'bookmarked'
      }
    },
  }
}

export function CodeBlock({ code, language, showLineNumbers = false, wordWrap = false, highlightLine, bookmarkedLines, onLineNumberClick, startLine = 1, selectionHighlight }: CodeBlockProps) {
  const safeCode = code ?? ''
  const [fontSize, setFontSize] = useState(() => {
    const saved = localStorage.getItem('code-viewer:font-size')
    return saved ? Number(saved) : DEFAULT_FONT_SIZE
  })
  const lastPinchDistance = useRef(0)
  const fontSizeRef = useRef(fontSize)
  fontSizeRef.current = fontSize

  const lineCount = useMemo(() => safeCode.split('\n').length, [safeCode])
  const gutterWidth = useMemo(() => Math.max(2, String(lineCount).length) * 0.6 + 1, [lineCount])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const transformers = useMemo(
    () => showLineNumbers ? [createLineTransformer(bookmarkedLines)] : undefined,
    [showLineNumbers, bookmarkedLines],
  )

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      lastPinchDistance.current = Math.sqrt(dx * dx + dy * dy)
    }
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const distance = Math.sqrt(dx * dx + dy * dy)
      if (lastPinchDistance.current > 0) {
        const scale = distance / lastPinchDistance.current
        setFontSize((prev) =>
          Math.min(Math.max(prev * scale, MIN_FONT_SIZE), MAX_FONT_SIZE),
        )
      }
      lastPinchDistance.current = distance
    }
  }, [])

  const handleTouchEnd = useCallback(() => {
    lastPinchDistance.current = 0
    localStorage.setItem('code-viewer:font-size', String(fontSizeRef.current))
  }, [])

  const classNames = [
    wordWrap ? 'code-wrap-mode' : undefined,
    showLineNumbers ? 'code-line-numbers' : undefined,
  ].filter(Boolean).join(' ') || undefined

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ fontSize, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.5, display: 'flex' }}
    >
      {/* Separate gutter only in non-wrap mode (stays fixed during horizontal scroll) */}
      {showLineNumbers && !wordWrap && (
        <div
          aria-hidden
          style={{
            width: `${gutterWidth}em`,
            flexShrink: 0,
            textAlign: 'right',
            paddingRight: '0.5em',
            color: '#858585',
            userSelect: 'none',
            borderRight: '1px solid #333',
            paddingTop: '0.5em',
          }}
        >
          {Array.from({ length: lineCount }, (_, i) => {
            const lineNum = startLine + i
            const isBookmarked = bookmarkedLines?.has(lineNum)
            return (
              <div
                key={i}
                onClick={onLineNumberClick ? (e) => { e.stopPropagation(); onLineNumberClick(lineNum) } : undefined}
                style={{
                  ...(isBookmarked ? { color: '#e2b93d' } : undefined),
                  ...(onLineNumberClick ? { cursor: 'pointer', WebkitTapHighlightColor: 'transparent' } : undefined),
                }}
              >
                {isBookmarked ? `\u2605${lineNum}` : lineNum}
              </div>
            )
          })}
        </div>
      )}
      <div
        className={classNames}
        onClick={wordWrap && onLineNumberClick ? (e) => {
          // In wrap mode, line numbers are CSS pseudo-elements — detect click in gutter area
          const target = e.currentTarget
          const rect = target.getBoundingClientRect()
          if (e.clientX - rect.left > 50) return // not in gutter area
          // Find which .line element was clicked
          const lineEls = target.querySelectorAll('.line')
          for (let i = 0; i < lineEls.length; i++) {
            const lineRect = lineEls[i].getBoundingClientRect()
            if (e.clientY >= lineRect.top && e.clientY <= lineRect.bottom) {
              const dataLine = lineEls[i].getAttribute('data-line')
              if (dataLine) { e.stopPropagation(); onLineNumberClick(parseInt(dataLine, 10)) }
              break
            }
          }
        } : undefined}
        style={{
          flex: 1,
          minWidth: 0,
          overflowX: wordWrap ? 'hidden' : 'auto',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        <ShikiHighlighter
          language={mapLanguage(language)}
          theme="dark-plus"
          showLanguage={false}
          addDefaultStyles={false}
          as="div"
          style={{ padding: '0.5em' }}
          transformers={transformers}
        >
          {safeCode}
        </ShikiHighlighter>
      </div>
      {/* Highlight overlay for Go to Definition target */}
      {highlightLine != null && highlightLine >= 0 && (
        <style>{`
          .line:nth-child(${highlightLine + 1}) {
            background: rgba(86, 156, 214, 0.2) !important;
            outline: 1px solid rgba(86, 156, 214, 0.4);
            border-radius: 2px;
            animation: highlight-fade 3s ease-out forwards;
          }
          @keyframes highlight-fade {
            0% { background: rgba(86, 156, 214, 0.3); }
            70% { background: rgba(86, 156, 214, 0.15); }
            100% { background: transparent; outline-color: transparent; }
          }
        `}</style>
      )}
      {/* Selection highlight for CodeTour steps */}
      {selectionHighlight && (() => {
        // Convert absolute line numbers to 1-based line indices within this snippet
        const startIdx = selectionHighlight.start.line - startLine + 1
        const endIdx = selectionHighlight.end.line - startLine + 1
        const rules: string[] = []
        for (let idx = startIdx; idx <= endIdx; idx++) {
          if (idx < 1 || idx > lineCount) continue
          rules.push(`.line:nth-child(${idx}) { background: rgba(86, 156, 214, 0.15) !important; }`)
        }
        return rules.length > 0 ? <style>{rules.join('\n')}</style> : null
      })()}
    </div>
  )
}
