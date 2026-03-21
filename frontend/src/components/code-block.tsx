import ShikiHighlighter from 'react-shiki'
import { useState, useRef, useCallback, useMemo } from 'react'

interface CodeBlockProps {
  code: string
  language: string
  showLineNumbers?: boolean
  wordWrap?: boolean
  highlightLine?: number | null
}

const MIN_FONT_SIZE = 8
const MAX_FONT_SIZE = 24
const DEFAULT_FONT_SIZE = 13

// Map VS Code languageId → Shiki language identifier
const LANGUAGE_MAP: Record<string, string> = {
  typescriptreact: 'tsx',
  javascriptreact: 'jsx',
  shellscript: 'bash',
  plaintext: 'text',
}

function mapLanguage(lang: string): string {
  return LANGUAGE_MAP[lang] ?? lang
}

// Shiki transformer: inject data-line attribute on each .line span
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const lineNumberTransformer: any = {
  line(node: { properties: Record<string, unknown> }, line: number) {
    node.properties['data-line'] = line
  },
}

export function CodeBlock({ code, language, showLineNumbers = false, wordWrap = false, highlightLine }: CodeBlockProps) {
  const safeCode = code ?? ''
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE)
  const lastPinchDistance = useRef(0)

  const lineCount = useMemo(() => safeCode.split('\n').length, [safeCode])
  const gutterWidth = useMemo(() => Math.max(2, String(lineCount).length) * 0.6 + 1, [lineCount])

  const transformers = useMemo(
    () => showLineNumbers ? [lineNumberTransformer] : undefined,
    [showLineNumbers],
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
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </div>
      )}
      <div
        className={classNames}
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
    </div>
  )
}
