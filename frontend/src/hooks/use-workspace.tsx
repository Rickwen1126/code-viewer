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

    const storedWorkspace = workspace
    let cancelled = false

    setWorkspaceReady(false)
    void (async () => {
      try {
        const listRes = await request<Record<string, never>, ListWorkspacesResultPayload>('connection.listWorkspaces', {})
        const matchedWorkspace = findMatchingWorkspace(storedWorkspace, listRes.payload.workspaces)
        if (!matchedWorkspace) {
          if (!cancelled) {
            setWorkspace(null)
            setWorkspaceReady(true)
          }
          return
        }

        try {
          const selectRes = await request<{ extensionId: string }, SelectWorkspaceResultPayload>(
            'connection.selectWorkspace',
            { extensionId: matchedWorkspace.extensionId },
          )
          if (!cancelled) {
            setWorkspace(selectRes.payload.workspace)
          }
        } catch {
          // Only clear the stored workspace after a confirmed live-list miss.
          // A request failure can be transient, so keep the snapshot unless a
          // second live lookup proves the workspace is truly gone.
          try {
            const retryListRes = await request<Record<string, never>, ListWorkspacesResultPayload>('connection.listWorkspaces', {})
            const retryMatch = findMatchingWorkspace(storedWorkspace, retryListRes.payload.workspaces)
            if (!retryMatch && !cancelled) {
              setWorkspace(null)
            }
          } catch {
            // keep the stored workspace snapshot on transient failures
          }
        } finally {
          if (!cancelled) {
            setWorkspaceReady(true)
          }
        }
      } catch {
        if (!cancelled) {
          setWorkspaceReady(true)
        }
      }
    })()

    return () => {
      cancelled = true
    }
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
