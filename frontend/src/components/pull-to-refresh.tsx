import { useState, useRef, useCallback, useEffect } from 'react'
import { saveScrollPosition, getScrollPosition } from '../hooks/use-scroll-restore'

interface PullToRefreshProps {
  onRefresh: () => Promise<void>
  children: React.ReactNode
  /** When set, scroll position is saved on unmount and restored on mount. */
  scrollKey?: string
}

const THRESHOLD = 60
const MAX_PULL = 80

export function PullToRefresh({ onRefresh, children, scrollKey }: PullToRefreshProps) {
  const [pulling, setPulling] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [pullDistance, setPullDistance] = useState(0)
  const startY = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (containerRef.current && containerRef.current.scrollTop === 0) {
      startY.current = e.touches[0].clientY
      setPulling(true)
    }
  }, [])

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!pulling) return
      const diff = e.touches[0].clientY - startY.current
      if (diff > 0) {
        setPullDistance(Math.min(diff * 0.5, MAX_PULL)) // apply resistance
      }
    },
    [pulling],
  )

  const handleTouchEnd = useCallback(async () => {
    if (pullDistance > THRESHOLD) {
      setRefreshing(true)
      setPullDistance(0)
      try {
        await onRefresh()
      } finally {
        setRefreshing(false)
      }
    } else {
      setPullDistance(0)
    }
    setPulling(false)
  }, [pullDistance, onRefresh])

  // Scroll restore: restore on mount, save on unmount
  useEffect(() => {
    if (!scrollKey) return
    const el = containerRef.current
    const saved = getScrollPosition(scrollKey)
    if (el && saved != null) {
      requestAnimationFrame(() => {
        el.scrollTop = saved
      })
    }
    return () => {
      if (el) saveScrollPosition(scrollKey, el.scrollTop)
    }
  }, [scrollKey])

  const indicatorHeight = refreshing ? 40 : pullDistance

  return (
    <div
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ height: '100%', overflow: 'auto', WebkitOverflowScrolling: 'touch' }}
    >
      {(pullDistance > 0 || refreshing) && (
        <div
          style={{
            height: indicatorHeight,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#888',
            fontSize: 12,
            transition: refreshing ? 'height 200ms ease' : 'none',
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          {refreshing
            ? 'Refreshing...'
            : pullDistance > THRESHOLD
              ? 'Release to refresh'
              : 'Pull to refresh'}
        </div>
      )}
      {children}
    </div>
  )
}
