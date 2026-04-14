import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { cacheService, type WorkspaceEntry } from '../../services/cache'
import { useWebSocket } from '../../hooks/use-websocket'
import { useWorkspace } from '../../hooks/use-workspace'
import type { ListWorkspacesResultPayload, SelectWorkspaceResultPayload } from '@code-viewer/shared'

interface ResolverDetail {
  label: string
  value: string | null
}

interface WorkspaceScopedResolverPageProps {
  title: string
  workspaceRef: string | null
  targetUrl: string | null
  invalidMessage: string
  waitingMessage?: string
  selectingLabel?: string
  details?: ResolverDetail[]
}

export function WorkspaceScopedResolverPage({
  title,
  workspaceRef,
  targetUrl,
  invalidMessage,
  waitingMessage = 'Resolving workspace...',
  selectingLabel = 'workspace',
  details = [],
}: WorkspaceScopedResolverPageProps) {
  const navigate = useNavigate()
  const { connectionState, request } = useWebSocket()
  const { workspace: currentWorkspace, workspaceReady, selectWorkspace } = useWorkspace()
  const [workspaces, setWorkspaces] = useState<WorkspaceEntry[]>([])
  const [statusText, setStatusText] = useState(waitingMessage)
  const [error, setError] = useState<string | null>(null)
  const [liveLookupState, setLiveLookupState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle')
  const attemptedRef = useRef(false)

  useEffect(() => {
    cacheService.getWorkspaceList().then((cached) => {
      if (cached?.length) {
        setWorkspaces(cached)
      }
    })
  }, [])

  useEffect(() => {
    if (connectionState !== 'connected') {
      setLiveLookupState('idle')
      return
    }

    setLiveLookupState('loading')
    request<Record<string, never>, ListWorkspacesResultPayload>('connection.listWorkspaces', {})
      .then((res) => {
        setWorkspaces(res.payload.workspaces)
        cacheService.setWorkspaceList(res.payload.workspaces)
        setLiveLookupState('ready')
      })
      .catch(() => {
        setLiveLookupState('failed')
      })
  }, [connectionState, request])

  const matchingWorkspace = useMemo(() => {
    if (!workspaceRef) return null
    return workspaces.find((entry) =>
      (entry.workspaceKey === workspaceRef || entry.rootPath === workspaceRef) &&
      entry.status === 'connected',
    ) ?? null
  }, [workspaces, workspaceRef])

  useEffect(() => {
    if (!workspaceRef || !targetUrl) {
      setError(invalidMessage)
      return
    }

    if (attemptedRef.current) return

    if (
      workspaceReady &&
      currentWorkspace &&
      (currentWorkspace.workspaceKey === workspaceRef || currentWorkspace.rootPath === workspaceRef)
    ) {
      attemptedRef.current = true
      navigate(targetUrl, { replace: true })
      return
    }

    if (connectionState !== 'connected') {
      setStatusText('Waiting for backend connection...')
      return
    }

    if (liveLookupState === 'loading' || liveLookupState === 'idle') {
      setStatusText(waitingMessage)
      return
    }

    if (liveLookupState === 'failed') {
      setError('Backend did not respond while resolving this link. Reconnect the workspace and try again.')
      return
    }

    if (!matchingWorkspace) {
      setError(`No connected ${selectingLabel} matches this link. Connect the workspace first and try again.`)
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
      setError(`Failed to select ${selectingLabel} for this link.`)
    })
  }, [
    workspaceRef,
    targetUrl,
    invalidMessage,
    selectingLabel,
    waitingMessage,
    currentWorkspace,
    workspaceReady,
    connectionState,
    liveLookupState,
    matchingWorkspace,
    navigate,
    request,
    selectWorkspace,
  ])

  return (
    <div style={{ padding: 16, paddingTop: 'calc(16px + env(safe-area-inset-top))' }}>
      <div style={{ fontSize: 18, fontWeight: 600, color: '#d4d4d4', marginBottom: 8 }}>
        {title}
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
          {details
            .filter((detail) => detail.value)
            .map((detail) => (
              <div
                key={detail.label}
                style={{ fontSize: 12, color: '#666', marginBottom: 4, wordBreak: 'break-all' }}
              >
                {detail.label}: {detail.value}
              </div>
            ))}
        </>
      )}
    </div>
  )
}
