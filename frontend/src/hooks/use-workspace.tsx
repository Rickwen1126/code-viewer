import { useState, useEffect, useCallback, createContext, useContext } from 'react'
import { wsClient } from '../services/ws-client'
import { useWebSocket } from './use-websocket'
import type { Workspace, SelectWorkspaceResultPayload } from '@code-viewer/shared'

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
  const { connectionState, request } = useWebSocket()
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

  // Auto-rebind workspace on reconnect: tell backend which extension to relay to.
  // Without this, a page reload has workspace in localStorage but backend's
  // frontend entry has selectedExtensionId=null → requests go nowhere.
  useEffect(() => {
    if (connectionState !== 'connected' || !workspace) return
    request<{ extensionId: string }, SelectWorkspaceResultPayload>(
      'connection.selectWorkspace',
      { extensionId: workspace.extensionId },
    ).then(res => {
      // Update workspace in case details changed (e.g. gitBranch)
      setWorkspace(res.payload.workspace)
    }).catch(() => {
      // Extension no longer exists — clear stale workspace
      setWorkspace(null)
    })
  }, [connectionState]) // only on connection change, not workspace change

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
