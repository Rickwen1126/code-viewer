import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router'
import { useWebSocket } from '../../hooks/use-websocket'
import { wsClient } from '../../services/ws-client'
import { cacheService } from '../../services/cache'
import { useWorkspace } from '../../hooks/use-workspace'
import { PullToRefresh } from '../../components/pull-to-refresh'
import type { GitStatusResultPayload, GitStatusChangedPayload } from '@code-viewer/shared'

const STATUS_COLORS: Record<string, string> = {
  added: '#4ec9b0',
  modified: '#e2b93d',
  deleted: '#f48771',
  renamed: '#9cdcfe',
}

const STATUS_LABELS: Record<string, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
}

export function GitChangesPage() {
  const { request, connectionState } = useWebSocket()
  const { workspace } = useWorkspace()
  const navigate = useNavigate()
  const [gitStatus, setGitStatus] = useState<GitStatusResultPayload | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (connectionState !== 'connected' || !workspace) {
      // Try loading from cache even when offline
      if (workspace) {
        cacheService.getGitStatus(workspace.extensionId).then((cached) => {
          if (cached) {
            setGitStatus({
              branch: cached.branch,
              ahead: cached.ahead,
              behind: cached.behind,
              changedFiles: cached.changedFiles,
            })
          }
          setLoading(false)
        }).catch(() => setLoading(false))
      } else {
        setLoading(false)
      }
      return
    }

    loadStatus()

    // Subscribe to real-time git status changes
    const unsub = wsClient.subscribe('git.statusChanged', (_msg) => {
      const _payload = _msg.payload as GitStatusChangedPayload
      loadStatus()
    })

    return unsub
  }, [connectionState, workspace])

  const loadStatus = useCallback(async () => {
    try {
      setLoading(true)
      const res = await request<Record<string, never>, GitStatusResultPayload>('git.status', {})
      setGitStatus(res.payload)
      // Cache it
      if (workspace) {
        cacheService.setGitStatus(workspace.extensionId, {
          branch: res.payload.branch,
          ahead: res.payload.ahead,
          behind: res.payload.behind,
          changedFiles: res.payload.changedFiles,
        })
      }
    } catch {
      // Fall back to cache
      if (workspace) {
        const cached = await cacheService.getGitStatus(workspace.extensionId)
        if (cached) {
          setGitStatus({
            branch: cached.branch,
            ahead: cached.ahead,
            behind: cached.behind,
            changedFiles: cached.changedFiles,
          })
        }
      }
    } finally {
      setLoading(false)
    }
  }, [request, workspace])

  function handleFileClick(path: string) {
    navigate(`/git/diff/${encodeURIComponent(path)}`)
  }

  if (loading) {
    return <div style={{ padding: 16, color: '#888' }}>Loading git status...</div>
  }

  if (!gitStatus) {
    return (
      <div style={{ padding: 16, color: '#888' }}>
        {workspace ? 'No git repository found.' : 'No workspace selected.'}
      </div>
    )
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header: branch + ahead/behind */}
      <div
        style={{
          padding: '10px 14px',
          paddingTop: 'calc(10px + env(safe-area-inset-top))',
          borderBottom: '1px solid #333',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 14, color: '#d4d4d4', fontWeight: 600 }}>
          {gitStatus.branch || '(no branch)'}
        </span>
        {gitStatus.ahead > 0 && (
          <span
            style={{
              fontSize: 11,
              color: '#4ec9b0',
              background: '#1e3a1e',
              padding: '1px 6px',
              borderRadius: 4,
            }}
          >
            ↑{gitStatus.ahead}
          </span>
        )}
        {gitStatus.behind > 0 && (
          <span
            style={{
              fontSize: 11,
              color: '#f48771',
              background: '#3a1e1e',
              padding: '1px 6px',
              borderRadius: 4,
            }}
          >
            ↓{gitStatus.behind}
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#888' }}>
          {gitStatus.changedFiles.length} changed
        </span>
      </div>

      {/* Changed files list */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
      <PullToRefresh onRefresh={loadStatus}>
        {gitStatus.changedFiles.length === 0 ? (
          <div style={{ padding: 16, color: '#888', fontSize: 13 }}>
            No changes — working tree is clean.
          </div>
        ) : (
          gitStatus.changedFiles.map((file) => (
            <button
              key={file.path}
              onClick={() => handleFileClick(file.path)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                padding: '10px 14px',
                background: 'none',
                border: 'none',
                borderBottom: '1px solid #2a2a2a',
                cursor: 'pointer',
                textAlign: 'left',
                minHeight: 44,
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  width: 16,
                  fontSize: 12,
                  fontWeight: 700,
                  color: STATUS_COLORS[file.status] ?? '#888',
                }}
              >
                {STATUS_LABELS[file.status] ?? '?'}
              </span>
              <span
                style={{
                  flex: 1,
                  fontSize: 13,
                  color: '#d4d4d4',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {file.path}
              </span>
              {file.oldPath && (
                <span style={{ fontSize: 11, color: '#666' }}>
                  ← {file.oldPath}
                </span>
              )}
              <span style={{ fontSize: 11, color: '#888', flexShrink: 0 }}>›</span>
            </button>
          ))
        )}
      </PullToRefresh>
      </div>
    </div>
  )
}
