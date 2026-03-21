import ShikiHighlighter from 'react-shiki'
import { useState, useRef, useCallback, useMemo } from 'react'

interface CodeBlockProps {
  code: string
  language: string
  showLineNumbers?: boolean
}

const MIN_FONT_SIZE = 8
const MAX_FONT_SIZE = 24
const DEFAULT_FONT_SIZE = 13

export function CodeBlock({ code, language, showLineNumbers = false }: CodeBlockProps) {
  const safeCode = code ?? ''
  const [fontSize, setFontSize] = useState(DEFAULT_FONT_SIZE)
  const lastPinchDistance = useRef(0)

  const lineCount = useMemo(() => safeCode.split('\n').length, [safeCode])
  const gutterWidth = useMemo(() => Math.max(2, String(lineCount).length) * 0.6 + 1, [lineCount])

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

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ fontSize, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.5, display: 'flex' }}
    >
      {showLineNumbers && (
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
      <div style={{ flex: 1, minWidth: 0 }}>
        <ShikiHighlighter language={language} theme="dark-plus" showLanguage={false}>
          {safeCode}
        </ShikiHighlighter>
      </div>
    </div>
  )
}
