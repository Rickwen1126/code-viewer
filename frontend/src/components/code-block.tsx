import ShikiHighlighter from 'react-shiki'
import { useState, useRef, useCallback, useMemo, useLayoutEffect } from 'react'

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

// Shiki transformer factory: inject display line number + optional .bookmarked class
function createLineTransformer(startLine: number, bookmarked?: Set<number>) {
  return {
    line(node: { properties: Record<string, unknown> }, line: number) {
      const displayLine = startLine + line - 1
      node.properties['data-line'] = displayLine
      const isBookmarked = bookmarked?.has(displayLine)
      if (isBookmarked) {
        const existing = (node.properties['class'] as string) ?? ''
        node.properties['class'] = existing ? `${existing} bookmarked` : 'bookmarked'
      }
    },
  }
}

function wrapLineContent(root: HTMLElement) {
  const lines = root.querySelectorAll<HTMLElement>('.line')

  lines.forEach((line) => {
    const existingGutter = line.querySelector<HTMLElement>(':scope > .line-gutter')
    const existingContent = line.querySelector<HTMLElement>(':scope > .line-content')
    const lineNumber = line.dataset.line
    const isBookmarked = line.classList.contains('bookmarked')

    if (existingGutter && existingContent) {
      existingGutter.textContent = isBookmarked ? `\u2605${lineNumber ?? ''}` : lineNumber ?? ''
      existingGutter.classList.toggle('bookmarked', isBookmarked)
      return
    }

    const childNodes = Array.from(line.childNodes)
    const gutter = document.createElement('span')
    gutter.className = isBookmarked ? 'line-gutter bookmarked' : 'line-gutter'
    gutter.setAttribute('aria-hidden', 'true')
    gutter.textContent = isBookmarked ? `\u2605${lineNumber ?? ''}` : lineNumber ?? ''

    const content = document.createElement('span')
    content.className = 'line-content'
    for (const child of childNodes) {
      content.appendChild(child)
    }

    line.append(gutter, content)
  })
}

function unwrapLineContent(root: HTMLElement) {
  const lines = root.querySelectorAll<HTMLElement>('.line')

  lines.forEach((line) => {
    const gutter = line.querySelector<HTMLElement>(':scope > .line-gutter')
    const content = line.querySelector<HTMLElement>(':scope > .line-content')
    if (!gutter || !content) return

    while (content.firstChild) {
      line.insertBefore(content.firstChild, gutter)
    }

    gutter.remove()
    content.remove()
  })
}

export function CodeBlock({ code, language, showLineNumbers = false, wordWrap = false, highlightLine, bookmarkedLines, onLineNumberClick, startLine = 1, selectionHighlight }: CodeBlockProps) {
  const safeCode = code ?? ''
  const codeRootRef = useRef<HTMLDivElement | null>(null)
  const [fontSize, setFontSize] = useState(() => {
    const saved = localStorage.getItem('code-viewer:font-size')
    return saved ? Number(saved) : DEFAULT_FONT_SIZE
  })
  const lastPinchDistance = useRef(0)
  const fontSizeRef = useRef(fontSize)
  fontSizeRef.current = fontSize

  const lineCount = useMemo(() => safeCode.split('\n').length, [safeCode])
  const maxLineNumber = useMemo(
    () => Math.max(startLine, startLine + lineCount - 1),
    [startLine, lineCount],
  )
  const gutterWidth = useMemo(
    () => Math.max(2, String(maxLineNumber).length) * 0.6 + 1,
    [maxLineNumber],
  )

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const transformers = useMemo(
    () => showLineNumbers ? [createLineTransformer(startLine, bookmarkedLines)] : undefined,
    [showLineNumbers, startLine, bookmarkedLines],
  )

  useLayoutEffect(() => {
    const root = codeRootRef.current
    if (!root) return

    if (!showLineNumbers) {
      unwrapLineContent(root)
      return
    }

    if (wordWrap) {
      wrapLineContent(root)
      return
    }

    unwrapLineContent(root)
  }, [safeCode, showLineNumbers, wordWrap, bookmarkedLines, startLine])

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
      style={{
        fontSize,
        fontFamily: "'JetBrains Mono', monospace",
        lineHeight: 1.5,
        display: 'flex',
        ['--code-gutter-width' as string]: `${gutterWidth}em`,
      }}
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
        ref={codeRootRef}
        className={classNames}
        onClick={wordWrap && onLineNumberClick ? (e) => {
          const gutter = (e.target as HTMLElement | null)?.closest('.line-gutter')
          if (!gutter) return
          const lineEl = gutter.closest('.line')
          const dataLine = lineEl?.getAttribute('data-line')
          if (!dataLine) return
          e.stopPropagation()
          onLineNumberClick(parseInt(dataLine, 10))
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
