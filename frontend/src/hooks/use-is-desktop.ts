import { useState, useEffect } from 'react'

const DESKTOP_BREAKPOINT = 1024
const COMPACT_BREAKPOINT = 768

/**
 * Detect desktop viewport via matchMedia.
 * Live-updates on resize / device rotation without reload.
 */
export function useIsDesktop(breakpoint = DESKTOP_BREAKPOINT): boolean {
  const [matches, setMatches] = useState(
    () => window.matchMedia(`(min-width: ${breakpoint}px)`).matches,
  )

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${breakpoint}px)`)
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [breakpoint])

  return matches
}

/** True when viewport is >= 768px but < 1024px (tablet / compact desktop). */
export function useIsCompactDesktop(): boolean {
  const isAboveCompact = useIsDesktop(COMPACT_BREAKPOINT)
  const isFullDesktop = useIsDesktop(DESKTOP_BREAKPOINT)
  return isAboveCompact && !isFullDesktop
}
