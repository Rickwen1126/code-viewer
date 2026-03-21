import { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react'
import { wsClient } from '../services/ws-client'
import type { Workspace } from '@code-viewer/shared'

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
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const workspaceRef = useRef<Workspace | null>(null)
  workspaceRef.current = workspace

  useEffect(() => {
    // Listen for extension disconnect
    const unsub = wsClient.subscribe('connection.extensionDisconnected', (msg) => {
      const payload = msg.payload as { extensionId: string }
      if (workspaceRef.current?.extensionId === payload.extensionId) {
        setWorkspace(null)
      }
    })
    return unsub
  }, [])  // Empty dependency array — subscribe once

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
