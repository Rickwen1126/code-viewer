import { useSyncExternalStore } from 'react'
import { getTheme, subscribeTheme, type ThemeName } from '../services/theme'

/** Reactive current theme. Components re-render when setTheme() is called anywhere. */
export function useTheme(): ThemeName {
  return useSyncExternalStore(subscribeTheme, getTheme)
}
