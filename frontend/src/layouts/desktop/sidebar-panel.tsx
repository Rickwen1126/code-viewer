import { useState, useCallback, type ReactNode } from 'react'
import { ResizeHandle } from './resize-handle'

const SIDEBAR_WIDTH_KEY = 'code-viewer:sidebar-width'
const DEFAULT_WIDTH = 280
const MIN_WIDTH = 200
const MAX_WIDTH = 480

function readSavedWidth(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY)
    if (!raw) return DEFAULT_WIDTH
    const w = parseInt(raw, 10)
    return w >= MIN_WIDTH && w <= MAX_WIDTH ? w : DEFAULT_WIDTH
  } catch {
    return DEFAULT_WIDTH
  }
}

function saveSidebarWidth(width: number): void {
  try {
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width))
  } catch {
    // ignore
  }
}

export function SidebarPanel({ children }: { children: ReactNode }) {
  const [width, setWidth] = useState(readSavedWidth)

  const handleResize = useCallback((newWidth: number) => {
    setWidth(newWidth)
    saveSidebarWidth(newWidth)
  }, [])

  return (
    <div
      style={{
        position: 'relative',
        width,
        height: '100%',
        background: '#1e1e1e',
        borderRight: '1px solid #333',
        flexShrink: 0,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ flex: 1, overflow: 'auto' }}>{children}</div>
      <ResizeHandle onResize={handleResize} minWidth={MIN_WIDTH} maxWidth={MAX_WIDTH} />
    </div>
  )
}
