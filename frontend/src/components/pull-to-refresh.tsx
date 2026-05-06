import { useState, useRef, useCallback, useEffect } from 'react'
import { saveScrollPosition, getScrollPosition } from '../hooks/use-scroll-restore'

interface PullToRefreshProps {
  onRefresh: () => Promise<void>
  children: React.ReactNode
  /** When set, scroll position is saved on unmount and restored on mount. */
  scrollKey?: string
  /** Re-run restoration after async list content renders. */
  restoreKey?: string | number | null
  /** Optional row selector to keep the selected list item visible after returning. */
  anchorSelector?: string
}

const THRESHOLD = 60
const MAX_PULL = 80
const MAX_ANCHOR_RESTORE_ATTEMPTS = 20

export function PullToRefresh({ onRefresh, children, scrollKey, restoreKey, anchorSelector }: PullToRefreshProps) {
  const [pulling, setPulling] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [pullDistance, setPullDistance] = useState(0)
  const startY = useRef(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const restoredAnchorKey = useRef<string | null>(null)
  const restoringRef = useRef(false)

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

  // Save continuously while the user scrolls. Saving only on unmount is too late
  // for route transitions: the list can be temporarily reset to top before the
  // cleanup runs, poisoning the stored position with 0.
  useEffect(() => {
    if (!scrollKey) return
    const el = containerRef.current
    if (!el) return

    const save = () => {
      if (!restoringRef.current) saveScrollPosition(scrollKey, el.scrollTop)
    }

    el.addEventListener('scroll', save, { passive: true })
    return () => {
      el.removeEventListener('scroll', save)
    }
  }, [scrollKey])

  // Scroll restore: retry after async content renders, then center an explicit anchor if present.
  useEffect(() => {
    if (!scrollKey) return
    const el = containerRef.current
    if (!el) return

    let frame = 0
    let timer = 0
    let attempts = 0
    let cancelled = false

    const restore = () => {
      if (cancelled) return
      const saved = getScrollPosition(scrollKey)
      restoringRef.current = saved != null || Boolean(anchorSelector)
      if (saved != null) {
        el.scrollTop = saved
      }

      if (!anchorSelector) {
        attempts += 1
        if (saved == null || Math.abs(el.scrollTop - saved) < 2 || attempts >= MAX_ANCHOR_RESTORE_ATTEMPTS) {
          restoringRef.current = false
          return
        }
        timer = window.setTimeout(() => {
          frame = requestAnimationFrame(restore)
        }, 50)
        return
      }

      const anchorKey = `${scrollKey}:${restoreKey ?? ''}:${anchorSelector}`
      if (restoredAnchorKey.current === anchorKey) {
        restoringRef.current = false
        return
      }

      const anchor = el.querySelector<HTMLElement>(anchorSelector)
      if (!anchor) {
        attempts += 1
        if (attempts < MAX_ANCHOR_RESTORE_ATTEMPTS) {
          timer = window.setTimeout(() => {
            frame = requestAnimationFrame(restore)
          }, 50)
        } else {
          restoringRef.current = false
        }
        return
      }

      anchor.scrollIntoView({ block: 'center' })
      restoredAnchorKey.current = anchorKey
      restoringRef.current = false
    }

    frame = requestAnimationFrame(restore)

    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      clearTimeout(timer)
      restoringRef.current = false
    }
  }, [scrollKey, restoreKey, anchorSelector])

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
