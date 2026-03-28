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
}

export function InFileSearch({ content, visible, onClose, onMatchesChange }: InFileSearchProps) {
  const [query, setQuery] = useState('')
  const [currentIndex, setCurrentIndex] = useState(0)
  const [matches, setMatches] = useState<SearchMatch[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus input when becoming visible
  useEffect(() => {
    if (visible) {
      setTimeout(() => inputRef.current?.focus(), 50)
    } else {
      setQuery('')
      setMatches([])
      setCurrentIndex(0)
      onMatchesChange([], -1)
    }
  }, [visible])

  // Find matches whenever query or content changes
  useEffect(() => {
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
  }, [query, content])

  const goTo = useCallback((newIndex: number) => {
    if (matches.length === 0) return
    const wrapped = ((newIndex % matches.length) + matches.length) % matches.length
    setCurrentIndex(wrapped)
    onMatchesChange(matches, wrapped)
  }, [matches, onMatchesChange])

  const goPrev = useCallback(() => goTo(currentIndex - 1), [goTo, currentIndex])
  const goNext = useCallback(() => goTo(currentIndex + 1), [goTo, currentIndex])

  if (!visible) return null

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
        onChange={(e) => setQuery(e.target.value)}
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
        {matches.length > 0 ? `${currentIndex + 1}/${matches.length}` : query ? '0/0' : ''}
      </span>
      <button onClick={goPrev} disabled={matches.length === 0} style={navBtnStyle}>
        &#x25B2;
      </button>
      <button onClick={goNext} disabled={matches.length === 0} style={navBtnStyle}>
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
