import { useState, useEffect, useCallback, createContext, useContext } from 'react'
import type { Workspace } from '@code-viewer/shared'

const STORAGE_KEY = 'code-viewer:selected-workspace'

interface WorkspaceContextValue {
  workspace: Workspace | null
  selectWorkspace: (ws: Workspace) => void
  clearWorkspace: () => void
}

export const WorkspaceContext = createContext<WorkspaceContextValue>({
  workspace: null,
  selectWorkspace: () => {},
  clearWorkspace: () => {},
})

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? (JSON.parse(raw) as Workspace) : null
    } catch {
      return null
    }
  })

  // Persist to localStorage on change
  useEffect(() => {
    try {
      if (workspace) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace))
      } else {
        localStorage.removeItem(STORAGE_KEY)
      }
    } catch {
      // Safari private mode or quota exceeded
    }
  }, [workspace])

  // Note: we do NOT clear workspace on extension disconnect.
  // Cache-first means keep showing last-known state.
  // User explicitly navigates back to /workspaces to switch.

  const selectWorkspace = useCallback((ws: Workspace) => setWorkspace(ws), [])
  const clearWorkspace = useCallback(() => setWorkspace(null), [])

  return (
    <WorkspaceContext.Provider value={{ workspace, selectWorkspace, clearWorkspace }}>
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace() {
  return useContext(WorkspaceContext)
}
