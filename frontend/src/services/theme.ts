export type ThemeName = 'vscode' | 'eink'

export const THEME_STORAGE_KEY = 'code-viewer:theme'
export const DEFAULT_THEME: ThemeName = 'vscode'

const VALID_THEMES: readonly ThemeName[] = ['vscode', 'eink']

let current: ThemeName | null = null
const listeners = new Set<() => void>()

export function readStoredTheme(): ThemeName {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY)
    return VALID_THEMES.includes(raw as ThemeName) ? (raw as ThemeName) : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

export function getTheme(): ThemeName {
  if (current === null) current = readStoredTheme()
  return current
}

export function setTheme(theme: ThemeName): void {
  current = theme
  try { localStorage.setItem(THEME_STORAGE_KEY, theme) } catch { /* private mode */ }
  applyThemeToDocument(theme)
  listeners.forEach((l) => l())
}

export function subscribeTheme(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Reflect theme on <html data-theme> (activates eink.css) and the PWA theme-color. */
export function applyThemeToDocument(theme: ThemeName = getTheme()): void {
  if (theme === DEFAULT_THEME) {
    delete document.documentElement.dataset.theme
  } else {
    document.documentElement.dataset.theme = theme
  }
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'eink' ? '#ffffff' : '#1e1e1e')
}
