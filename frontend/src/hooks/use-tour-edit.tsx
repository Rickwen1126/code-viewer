import { useState, useCallback, createContext, useContext, useEffect } from 'react'
import { useWorkspace } from './use-workspace'

const STORAGE_KEY = 'code-viewer:tour-edit'

export interface TourEditState {
  tourId: string        // which tour
  tourTitle: string     // display name
  extensionId: string   // workspace guard
  afterIndex: number    // insert position (-1 = prepend, 0 = after first, etc.)
}

interface TourEditContextValue {
  tourEdit: TourEditState | null
  setTourEdit: (state: TourEditState | null) => void
  advanceIndex: () => void
}

const TourEditContext = createContext<TourEditContextValue>({
  tourEdit: null,
  setTourEdit: () => {},
  advanceIndex: () => {},
})

function loadFromStorage(): TourEditState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveToStorage(state: TourEditState | null): void {
  try {
    if (state) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  } catch {
    // Safari private mode or quota exceeded
  }
}

export function TourEditProvider({ children }: { children: React.ReactNode }) {
  const { workspace } = useWorkspace()
  const [tourEdit, setTourEditRaw] = useState<TourEditState | null>(loadFromStorage)

  // Workspace guard: auto-clear on mismatch
  useEffect(() => {
    if (tourEdit && workspace && tourEdit.extensionId !== workspace.extensionId) {
      setTourEditRaw(null)
      saveToStorage(null)
    }
  }, [workspace, tourEdit])

  const setTourEdit = useCallback((state: TourEditState | null) => {
    setTourEditRaw(state)
    saveToStorage(state)
  }, [])

  const advanceIndex = useCallback(() => {
    setTourEditRaw(prev => {
      if (!prev) return null
      const next = { ...prev, afterIndex: prev.afterIndex + 1 }
      saveToStorage(next)
      return next
    })
  }, [])

  return (
    <TourEditContext.Provider value={{ tourEdit, setTourEdit, advanceIndex }}>
      {children}
    </TourEditContext.Provider>
  )
}

export function useTourEdit() {
  return useContext(TourEditContext)
}
