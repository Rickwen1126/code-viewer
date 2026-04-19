import { useEffect, useRef } from 'react'

/** Module-level store — survives component unmount/remount within the same SPA session. */
const positions = new Map<string, number>()

export function saveScrollPosition(key: string, scrollTop: number): void {
  positions.set(key, scrollTop)
}

export function getScrollPosition(key: string): number | undefined {
  return positions.get(key)
}

/**
 * Saves scroll position on unmount, restores on mount.
 * Returns a ref to attach to the scrollable container element.
 */
export function useScrollRestore(key: string) {
  const ref = useRef<HTMLDivElement>(null)

  // Restore on mount
  useEffect(() => {
    const el = ref.current
    const saved = positions.get(key)
    if (el && saved != null) {
      requestAnimationFrame(() => {
        el.scrollTop = saved
      })
    }
  }, [key])

  // Save on unmount
  useEffect(() => {
    const el = ref.current
    return () => {
      if (el) positions.set(key, el.scrollTop)
    }
  }, [key])

  return ref
}
