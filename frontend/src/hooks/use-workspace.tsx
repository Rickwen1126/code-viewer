import { useState, useEffect, useCallback, createContext, useContext } from 'react'
import { useWebSocket } from './use-websocket'
import { findMatchingWorkspace, readStoredWorkspace, writeStoredWorkspace } from '../services/selected-workspace'
import type { Workspace, ListWorkspacesResultPayload, SelectWorkspaceResultPayload } from '@code-viewer/shared'

interface WorkspaceContextValue {
  workspace: Workspace | null
  workspaceReady: boolean
  selectWorkspace: (ws: Workspace) => void
  clearWorkspace: () => void
}

export const WorkspaceContext = createContext<WorkspaceContextValue>({
  workspace: null,
  workspaceReady: false,
  selectWorkspace: () => {},
  clearWorkspace: () => {},
})

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const { connectionState, request } = useWebSocket()
  const [workspace, setWorkspace] = useState<Workspace | null>(() => readStoredWorkspace())
  const [workspaceReady, setWorkspaceReady] = useState(() => workspace === null)

  // Persist to localStorage on change
  useEffect(() => {
    writeStoredWorkspace(workspace)
  }, [workspace])

  // Auto-rebind workspace on reconnect via stable identity. The persisted
  // workspace may carry a stale extensionId after a VS Code restart, so always
  // resolve against the live workspace list before selecting.
  useEffect(() => {
    if (connectionState !== 'connected') {
      setWorkspaceReady(false)
      return
    }

    if (!workspace) {
      setWorkspaceReady(true)
      return
    }

    setWorkspaceReady(false)
    request<Record<string, never>, ListWorkspacesResultPayload>('connection.listWorkspaces', {})
      .then((listRes) => {
        const matchedWorkspace = findMatchingWorkspace(workspace, listRes.payload.workspaces)
        if (!matchedWorkspace) {
          setWorkspace(null)
          setWorkspaceReady(true)
          return null
        }

        return request<{ extensionId: string }, SelectWorkspaceResultPayload>(
          'connection.selectWorkspace',
          { extensionId: matchedWorkspace.extensionId },
        )
      })
      .then((selectRes) => {
        if (!selectRes) return
        setWorkspace(selectRes.payload.workspace)
        setWorkspaceReady(true)
      })
      .catch(() => {
        // Unable to resolve a live workspace entry — clear stale workspace
        setWorkspace(null)
        setWorkspaceReady(true)
      })
  }, [connectionState]) // only on connection change, not workspace change

  const selectWorkspace = useCallback((ws: Workspace) => {
    setWorkspace(ws)
    setWorkspaceReady(true)
  }, [])
  const clearWorkspace = useCallback(() => {
    setWorkspace(null)
    setWorkspaceReady(connectionState === 'connected')
  }, [connectionState])

  return (
    <WorkspaceContext.Provider value={{ workspace, workspaceReady, selectWorkspace, clearWorkspace }}>
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace() {
  return useContext(WorkspaceContext)
}
