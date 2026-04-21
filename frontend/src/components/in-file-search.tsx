import { useState, useEffect, useRef, useCallback } from 'react'

export interface SearchMatch {
  line: number      // 0-based
  startCol: number
  endCol: number
}

interface InFileSearchProps {
  content: string
  visible: boolean
  onClose: () => void
  onMatchesChange: (matches: SearchMatch[], currentIndex: number) => void
  onQueryChange?: (query: string) => void
  /** When set, display this match info instead of internal counts */
  overrideMatchCount?: number
  overrideMatchIndex?: number
  /** When set, call this for next/prev instead of internal navigation */
  onNavigate?: (direction: 1 | -1) => void
}

export function InFileSearch({
  content, visible, onClose, onMatchesChange,
  onQueryChange, overrideMatchCount, overrideMatchIndex, onNavigate,
}: InFileSearchProps) {
  const [query, setQuery] = useState('')
  const [currentIndex, setCurrentIndex] = useState(0)
  const [matches, setMatches] = useState<SearchMatch[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  const isOverridden = overrideMatchCount !== undefined

  // Focus input when becoming visible
  useEffect(() => {
    if (visible) {
      setTimeout(() => inputRef.current?.focus(), 50)
    } else {
      setQuery('')
      setMatches([])
      setCurrentIndex(0)
      onMatchesChange([], -1)
      onQueryChange?.('')
    }
  }, [visible])

  // Find matches whenever query or content changes (skip if overridden)
  useEffect(() => {
    if (isOverridden) return

    if (!query || !content) {
      setMatches([])
      setCurrentIndex(0)
      onMatchesChange([], -1)
      return
    }

    const lowerQuery = query.toLowerCase()
    const lines = content.split('\n')
    const found: SearchMatch[] = []

    for (let line = 0; line < lines.length; line++) {
      const lowerLine = lines[line].toLowerCase()
      let startCol = 0
      while (true) {
        const idx = lowerLine.indexOf(lowerQuery, startCol)
        if (idx === -1) break
        found.push({ line, startCol: idx, endCol: idx + query.length })
        startCol = idx + 1
      }
    }

    setMatches(found)
    const idx = found.length > 0 ? 0 : -1
    setCurrentIndex(Math.max(idx, 0))
    onMatchesChange(found, idx)
  }, [query, content, isOverridden])

  const goTo = useCallback((newIndex: number) => {
    if (matches.length === 0) return
    const wrapped = ((newIndex % matches.length) + matches.length) % matches.length
    setCurrentIndex(wrapped)
    onMatchesChange(matches, wrapped)
  }, [matches, onMatchesChange])

  const goPrev = useCallback(() => {
    if (onNavigate) { onNavigate(-1); return }
    goTo(currentIndex - 1)
  }, [goTo, currentIndex, onNavigate])

  const goNext = useCallback(() => {
    if (onNavigate) { onNavigate(1); return }
    goTo(currentIndex + 1)
  }, [goTo, currentIndex, onNavigate])

  if (!visible) return null

  const displayCount = isOverridden ? overrideMatchCount! : matches.length
  const displayIndex = isOverridden ? (overrideMatchIndex ?? -1) : currentIndex

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        borderBottom: '1px solid #333',
        background: '#252526',
        flexShrink: 0,
      }}
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          onQueryChange?.(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.shiftKey ? goPrev() : goNext()
          } else if (e.key === 'Escape') {
            onClose()
          }
        }}
        placeholder="Find in file..."
        style={{
          flex: 1,
          background: '#1e1e1e',
          border: '1px solid #444',
          borderRadius: 4,
          color: '#d4d4d4',
          fontSize: 13,
          padding: '4px 8px',
          outline: 'none',
          minWidth: 0,
        }}
      />
      <span style={{ fontSize: 11, color: '#888', whiteSpace: 'nowrap', minWidth: 36, textAlign: 'center' }}>
        {displayCount > 0 ? `${displayIndex + 1}/${displayCount}` : query ? '0/0' : ''}
      </span>
      <button onClick={goPrev} disabled={displayCount === 0} style={navBtnStyle}>
        &#x25B2;
      </button>
      <button onClick={goNext} disabled={displayCount === 0} style={navBtnStyle}>
        &#x25BC;
      </button>
      <button onClick={onClose} style={navBtnStyle}>
        &#x2715;
      </button>
    </div>
  )
}

const navBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#888',
  fontSize: 14,
  padding: '2px 6px',
  cursor: 'pointer',
  lineHeight: 1,
}
