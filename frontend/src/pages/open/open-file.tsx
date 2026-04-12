import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { cacheService, type WorkspaceEntry } from '../../services/cache'
import { buildFileLocationUrl, parseFileLocationQuery } from '../../services/file-location'
import { useWebSocket } from '../../hooks/use-websocket'
import { useWorkspace } from '../../hooks/use-workspace'
import type { ListWorkspacesResultPayload, SelectWorkspaceResultPayload } from '@code-viewer/shared'

export function OpenFileResolverPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { connectionState, request } = useWebSocket()
  const { workspace: currentWorkspace, workspaceReady, selectWorkspace } = useWorkspace()
  const [workspaces, setWorkspaces] = useState<WorkspaceEntry[]>([])
  const [statusText, setStatusText] = useState('Resolving workspace...')
  const [error, setError] = useState<string | null>(null)
  const attemptedRef = useRef(false)

  const workspaceRef = searchParams.get('workspace')
  const path = searchParams.get('path')
  const fileQuery = parseFileLocationQuery(searchParams)
  const targetUrl = path ? buildFileLocationUrl(path, fileQuery) : null

  useEffect(() => {
    cacheService.getWorkspaceList().then((cached) => {
      if (cached?.length) {
        setWorkspaces(cached)
      }
    })
  }, [])

  useEffect(() => {
    if (connectionState !== 'connected') return
    request<Record<string, never>, ListWorkspacesResultPayload>('connection.listWorkspaces', {})
      .then((res) => {
        setWorkspaces(res.payload.workspaces)
        cacheService.setWorkspaceList(res.payload.workspaces)
      })
      .catch(() => {
        // Keep cache result if available.
      })
  }, [connectionState, request])

  const matchingWorkspace = useMemo(() => {
    if (!workspaceRef) return null
    return workspaces.find((entry) => entry.rootPath === workspaceRef && entry.status === 'connected') ?? null
  }, [workspaces, workspaceRef])

  useEffect(() => {
    if (!workspaceRef || !path || !targetUrl) {
      setError('Invalid link: workspace and path are required.')
      return
    }

    if (attemptedRef.current) return

    if (currentWorkspace?.rootPath === workspaceRef && workspaceReady) {
      attemptedRef.current = true
      navigate(targetUrl, { replace: true })
      return
    }

    if (connectionState !== 'connected') {
      setStatusText('Waiting for backend connection...')
      return
    }

    if (!matchingWorkspace) {
      setStatusText('Looking for matching workspace...')
      return
    }

    attemptedRef.current = true
    setStatusText(`Selecting ${matchingWorkspace.displayName}...`)
    request<{ extensionId: string }, SelectWorkspaceResultPayload>(
      'connection.selectWorkspace',
      { extensionId: matchingWorkspace.extensionId },
    ).then((res) => {
      selectWorkspace(res.payload.workspace)
      navigate(targetUrl, { replace: true })
    }).catch(() => {
      attemptedRef.current = false
      setError('Failed to select workspace for this link.')
    })
  }, [
    workspaceRef,
    path,
    targetUrl,
    currentWorkspace,
    workspaceReady,
    connectionState,
    matchingWorkspace,
    navigate,
    request,
    selectWorkspace,
  ])

  return (
    <div style={{ padding: 16, paddingTop: 'calc(16px + env(safe-area-inset-top))' }}>
      <div style={{ fontSize: 18, fontWeight: 600, color: '#d4d4d4', marginBottom: 8 }}>
        Open File Link
      </div>
      {error ? (
        <>
          <div style={{ fontSize: 13, color: '#f48771', marginBottom: 12 }}>{error}</div>
          <button
            onClick={() => navigate('/workspaces', { replace: true })}
            style={{
              background: 'none',
              border: '1px solid #444',
              color: '#569cd6',
              fontSize: 13,
              padding: '8px 12px',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Go to Workspaces
          </button>
        </>
      ) : (
        <>
          <div style={{ fontSize: 13, color: '#888', marginBottom: 6 }}>{statusText}</div>
          {workspaceRef && (
            <div style={{ fontSize: 12, color: '#666', marginBottom: 4, wordBreak: 'break-all' }}>
              workspace: {workspaceRef}
            </div>
          )}
          {path && (
            <div style={{ fontSize: 12, color: '#666', wordBreak: 'break-all' }}>
              path: {path}
            </div>
          )}
        </>
      )}
    </div>
  )
}
