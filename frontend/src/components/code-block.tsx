import ShikiHighlighter from 'react-shiki'
import { useState, useRef, useMemo } from 'react'
import type { ReactElement } from 'react'
import { wsClient } from '../services/ws-client'

interface SelectionRange {
  start: { line: number; character: number }
  end: { line: number; character: number }
}

interface CodeBlockProps {
  code: string
  language: string
  filePath?: string
  showLineNumbers?: boolean
  wordWrap?: boolean
  highlightLine?: number | null
  bookmarkedLines?: Set<number>
  onLineNumberClick?: (lineNum: number) => void
  /** Offset for line numbers (e.g., startLine=10 makes first line show as 10) */
  startLine?: number
  /** Highlight a selection range within the code */
  selectionHighlight?: SelectionRange | null
  /** Rendered code font size in px. Defaults to saved user preference. */
  fontSize?: number
}

export const CODE_FONT_SIZE_MIN = 8
export const CODE_FONT_SIZE_MAX = 24
export const CODE_FONT_SIZE_DEFAULT = 13
export const CODE_FONT_SIZE_STORAGE_KEY = 'code-viewer:font-size'

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
  plaintext: 'text',
  text: 'text',
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
      if (bookmarked?.has(displayLine)) {
        const existing = (node.properties['class'] as string) ?? ''
        node.properties['class'] = existing ? `${existing} bookmarked` : 'bookmarked'
      }
    },
  }
}

export function CodeBlock({
  code,
  language,
  filePath,
  showLineNumbers = false,
  wordWrap = false,
  highlightLine,
  bookmarkedLines,
  onLineNumberClick,
  startLine = 1,
  selectionHighlight,
  fontSize,
}: CodeBlockProps) {
  const safeCode = code ?? ''
  const [savedFontSize] = useState(() => {
    const saved = localStorage.getItem(CODE_FONT_SIZE_STORAGE_KEY)
    const parsed = Number(saved)
    return Number.isFinite(parsed) && parsed > 0
      ? Math.round(Math.min(Math.max(parsed, CODE_FONT_SIZE_MIN), CODE_FONT_SIZE_MAX))
      : CODE_FONT_SIZE_DEFAULT
  })
  const effectiveFontSize = fontSize ?? savedFontSize

  const lineCount = useMemo(() => safeCode.split('\n').length, [safeCode])
  const maxLineNumber = useMemo(
    () => Math.max(startLine, startLine + lineCount - 1),
    [startLine, lineCount],
  )
  const gutterWidth = useMemo(() => Math.max(2, String(lineCount).length) * 0.6 + 1, [lineCount])
  const wrapGutterWidth = useMemo(
    () => Math.max(2, String(maxLineNumber).length) * 0.6 + 1,
    [maxLineNumber],
  )
  const bookmarkSignature = Array.from(bookmarkedLines ?? []).sort((a, b) => a - b).join(',')
  const fallbackRef = useRef<`${string}` | null>(null)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const transformers = useMemo(
    () => showLineNumbers ? [createLineTransformer(startLine, bookmarkedLines)] : undefined,
    [showLineNumbers, startLine, bookmarkedLines, bookmarkSignature],
  )

  const classNames = [
    wordWrap ? 'code-wrap-mode' : undefined,
    showLineNumbers ? 'code-line-numbers' : undefined,
  ].filter(Boolean).join(' ') || undefined

  const mappedLanguage = mapLanguage(language)
  let renderedCode: ReactElement
  try {
    renderedCode = (
      <ShikiHighlighter
        key={wordWrap && showLineNumbers ? `${mappedLanguage}:${startLine}:${bookmarkSignature}` : undefined}
        language={mappedLanguage}
        theme="dark-plus"
        showLanguage={false}
        addDefaultStyles={false}
        as="div"
        style={{ padding: '0.5em' }}
        transformers={transformers}
      >
        {safeCode}
      </ShikiHighlighter>
    )
  } catch (err) {
    const signature = `${language}|${mappedLanguage}|${safeCode.length}`
    if (fallbackRef.current !== signature) {
      console.error('[CodeViewer] CodeBlock fallback to plaintext', {
        filePath,
        language,
        mappedLanguage,
        codeLength: safeCode.length,
        error: err instanceof Error ? err.message : String(err),
      })
      wsClient.send('codeblock.fallback', {
        filePath,
        language,
        mappedLanguage,
        codeLength: safeCode.length,
        error: err instanceof Error ? err.message : String(err),
      })
      fallbackRef.current = signature
    }

    renderedCode = (
      <pre style={{ margin: 0, padding: '0.5em', whiteSpace: 'pre', overflow: 'auto', color: '#d4d4d4' }}>
        <code>{safeCode}</code>
      </pre>
    )
  }

  return (
    <div
      style={{
        fontSize: effectiveFontSize,
        fontFamily: "'JetBrains Mono', monospace",
        lineHeight: 1.5,
        display: 'flex',
        ['--wrap-gutter-width' as string]: `${wrapGutterWidth}em`,
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
        className={classNames}
        onClick={wordWrap && onLineNumberClick ? (e) => {
          // In wrap mode, line numbers are CSS pseudo-elements — detect click in gutter area
          const target = e.currentTarget
          const rect = target.getBoundingClientRect()
          const wrapGutterClickWidth = (wrapGutterWidth + 0.5) * effectiveFontSize + 1
          if (e.clientX - rect.left > wrapGutterClickWidth) return // not in gutter area
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
        {renderedCode}
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
