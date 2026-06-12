import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  getTheme,
  setTheme,
  readStoredTheme,
  subscribeTheme,
  applyThemeToDocument,
  THEME_STORAGE_KEY,
} from '../services/theme'

const storage = new Map<string, string>()

vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storage.set(key, value)
  },
  removeItem: (key: string) => {
    storage.delete(key)
  },
})

describe('theme service', () => {
  beforeEach(() => {
    storage.clear()
    setTheme('vscode')
  })

  it('defaults to vscode when nothing is stored', () => {
    storage.delete(THEME_STORAGE_KEY)
    expect(readStoredTheme()).toBe('vscode')
  })

  it('falls back to vscode for invalid stored values', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'neon-pink')
    expect(readStoredTheme()).toBe('vscode')
  })

  it('reads a stored eink theme', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'eink')
    expect(readStoredTheme()).toBe('eink')
  })

  it('setTheme persists to localStorage and updates getTheme', () => {
    setTheme('eink')
    expect(getTheme()).toBe('eink')
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('eink')
  })

  it('setTheme reflects data-theme on <html>', () => {
    setTheme('eink')
    expect(document.documentElement.dataset.theme).toBe('eink')

    setTheme('vscode')
    expect(document.documentElement.dataset.theme).toBeUndefined()
  })

  it('applyThemeToDocument applies the persisted theme at boot', () => {
    setTheme('eink')
    delete document.documentElement.dataset.theme

    applyThemeToDocument()
    expect(document.documentElement.dataset.theme).toBe('eink')
  })

  it('notifies subscribers on change and stops after unsubscribe', () => {
    let calls = 0
    const unsubscribe = subscribeTheme(() => { calls++ })

    setTheme('eink')
    expect(calls).toBe(1)

    unsubscribe()
    setTheme('vscode')
    expect(calls).toBe(1)
  })

  it('updates the PWA theme-color meta when present', () => {
    let meta = document.querySelector('meta[name="theme-color"]')
    if (!meta) {
      meta = document.createElement('meta')
      meta.setAttribute('name', 'theme-color')
      document.head.appendChild(meta)
    }

    setTheme('eink')
    expect(meta.getAttribute('content')).toBe('#ffffff')

    setTheme('vscode')
    expect(meta.getAttribute('content')).toBe('#1e1e1e')
  })
})
