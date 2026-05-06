import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router'
import { useWebSocket } from '../../hooks/use-websocket'
import { wsClient } from '../../services/ws-client'
import { cacheService } from '../../services/cache'
import { debugLog } from '../../services/debug'
import { buildGitDiffUrl } from '../../services/semantic-navigation'
import { useWorkspace } from '../../hooks/use-workspace'
import { useDocumentVisibility } from '../../hooks/use-visibility'
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

interface Commit {
  hash: string
  hashShort: string
  message: string
  author: string
  date: string | null
}

type GitStatusWithGroups = GitStatusResultPayload & {
  stagedFiles?: Array<{ path: string; status: string; oldPath?: string }>
  unstagedFiles?: Array<{ path: string; status: string; oldPath?: string }>
}

interface WorkspaceLike {
  workspaceKey?: string | null
  extensionId?: string | null
}

interface SelectedGitDiff {
  key: string
  path: string
  status?: string
  commit?: string
  scope?: 'staged' | 'unstaged'
}

const SELECTED_GIT_DIFF_PREFIX = 'code-viewer:selected-git-diff'

function getSelectedGitDiffStorageKey(workspace: WorkspaceLike | null | undefined): string | null {
  const workspaceRef = workspace?.workspaceKey ?? workspace?.extensionId
  return workspaceRef ? `${SELECTED_GIT_DIFF_PREFIX}:${workspaceRef}` : null
}

function buildGitDiffSelection(
  path: string,
  options: { commit?: string; status?: string; scope?: 'staged' | 'unstaged' } = {},
): SelectedGitDiff {
  const key = options.commit
    ? `commit:${options.commit}:${options.status ?? ''}:${path}`
    : `worktree:${options.scope ?? ''}:${options.status ?? ''}:${path}`
  return { key, path, status: options.status, commit: options.commit, scope: options.scope }
}

function readSelectedGitDiff(workspace: WorkspaceLike | null | undefined): SelectedGitDiff | null {
  const storageKey = getSelectedGitDiffStorageKey(workspace)
  if (!storageKey) return null

  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SelectedGitDiff>
    if (typeof parsed.key !== 'string' || typeof parsed.path !== 'string') return null
    return {
      key: parsed.key,
      path: parsed.path,
      status: typeof parsed.status === 'string' ? parsed.status : undefined,
      commit: typeof parsed.commit === 'string' ? parsed.commit : undefined,
      scope: parsed.scope === 'staged' || parsed.scope === 'unstaged' ? parsed.scope : undefined,
    }
  } catch {
    return null
  }
}

function writeSelectedGitDiff(
  workspace: WorkspaceLike | null | undefined,
  selection: SelectedGitDiff,
): void {
  const storageKey = getSelectedGitDiffStorageKey(workspace)
  if (!storageKey) return
  try {
    localStorage.setItem(storageKey, JSON.stringify(selection))
  } catch {
    // ignore
  }
}

function FileRow({
  file,
  selected,
  onClick,
}: {
  file: { path: string; status: string; oldPath?: string }
  selected?: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '10px 14px',
        background: selected ? '#252526' : 'none',
        border: 'none',
        borderLeft: selected ? '2px solid #569cd6' : '2px solid transparent',
        borderBottom: '1px solid #2a2a2a',
        cursor: 'pointer',
        textAlign: 'left',
        minHeight: 40,
      }}
    >
      <span style={{ flexShrink: 0, width: 16, fontSize: 12, fontWeight: 700, color: STATUS_COLORS[file.status] ?? '#888' }}>
        {STATUS_LABELS[file.status] ?? '?'}
      </span>
      <span style={{ flex: 1, fontSize: 13, color: '#d4d4d4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {file.path}
      </span>
      {file.oldPath && <span style={{ fontSize: 11, color: '#666' }}>← {file.oldPath}</span>}
      <span style={{ fontSize: 11, color: '#888', flexShrink: 0 }}>›</span>
    </button>
  )
}

function SectionHeader({ title, count, color }: { title: string; count: number; color: string }) {
  return (
    <div style={{ padding: '8px 14px', fontSize: 11, color, textTransform: 'uppercase', background: '#1a1a1a', borderBottom: '1px solid #333' }}>
      {title} ({count})
    </div>
  )
}

export function GitChangesPage() {
  const { request, connectionState } = useWebSocket()
  const { workspace, workspaceReady } = useWorkspace()
  const visibility = useDocumentVisibility()
  const navigate = useNavigate()
  const [gitStatus, setGitStatus] = useState<GitStatusWithGroups | null>(null)
  const [commits, setCommits] = useState<Commit[]>([])
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null)
  const [commitFiles, setCommitFiles] = useState<Record<string, Array<{ path: string; status: string }>>>({})
  const [loading, setLoading] = useState(true)
  const [selectedDiff, setSelectedDiff] = useState<SelectedGitDiff | null>(() => readSelectedGitDiff(workspace))
  const restoredSelectedCommitRef = useRef<string | null>(null)

  useEffect(() => {
    setSelectedDiff(readSelectedGitDiff(workspace))
  }, [workspace])

  // Cache-first
  useEffect(() => {
    if (!workspace) return
    cacheService.getGitStatus(workspace.extensionId).then(cached => {
      if (cached) { setGitStatus(cached as GitStatusWithGroups); setLoading(false) }
    })
  }, [workspace])

  // Background fetch
  useEffect(() => {
    if (connectionState !== 'connected' || !workspace || !workspaceReady) return
    loadStatusBackground()
    loadCommits()
    const unsub = wsClient.subscribe('git.statusChanged', () => {
      debugLog('watch:git', 'event', { workspace: workspace.extensionId })
      loadStatusBackground()
    })
    return unsub
  }, [connectionState, workspace, workspaceReady])

  const loadStatusBackground = useCallback(async () => {
    try {
      debugLog('watch:git', 'request-status', { workspace: workspace?.extensionId ?? null })
      const res = await request<Record<string, never>, GitStatusWithGroups>('git.status', {})
      setGitStatus(res.payload)
      if (workspace) cacheService.setGitStatus(workspace.extensionId, res.payload)
    } catch { /* cached */ } finally { setLoading(false) }
  }, [request, workspace])

  const loadCommits = useCallback(async () => {
    try {
      debugLog('watch:git', 'request-log', { workspace: workspace?.extensionId ?? null })
      const res = await request<{ maxCount: number }, { commits: Commit[] }>('git.log', { maxCount: 30 })
      setCommits(res.payload.commits ?? [])
    } catch { /* ignore */ }
  }, [request])

  const loadStatus = useCallback(async () => {
    if (!gitStatus) setLoading(true)
    await loadStatusBackground()
    await loadCommits()
  }, [loadStatusBackground, loadCommits, gitStatus])

  const [wasHidden, setWasHidden] = useState(visibility !== 'visible')
  useEffect(() => {
    if (visibility !== 'visible') {
      if (!wasHidden) setWasHidden(true)
      return
    }

    if (!wasHidden || connectionState !== 'connected' || !workspace || !workspaceReady) return
    setWasHidden(false)
    debugLog('watch:git', 'resume-reload', { workspace: workspace.extensionId })
    void loadStatusBackground()
    void loadCommits()
  }, [visibility, wasHidden, connectionState, workspace, workspaceReady, loadStatusBackground, loadCommits])

  const loadCommitFiles = useCallback(async (hash: string) => {
    if (!commitFiles[hash]) {
      try {
        const res = await request<{ hash: string }, { hash: string; files: Array<{ path: string; status: string }> }>('git.commitFiles', { hash })
        setCommitFiles(prev => ({ ...prev, [hash]: res.payload.files ?? [] }))
      } catch {
        setCommitFiles(prev => ({ ...prev, [hash]: [] }))
      }
    }
  }, [commitFiles, request])

  useEffect(() => {
    if (!selectedDiff?.commit) return
    if (restoredSelectedCommitRef.current === selectedDiff.key) return
    restoredSelectedCommitRef.current = selectedDiff.key
    setExpandedCommit(selectedDiff.commit)
    void loadCommitFiles(selectedDiff.commit)
  }, [loadCommitFiles, selectedDiff])

  async function handleExpandCommit(hash: string) {
    if (expandedCommit === hash) { setExpandedCommit(null); return }
    setExpandedCommit(hash)
    await loadCommitFiles(hash)
  }

  function handleFileClick(path: string, status: string | undefined, scope: 'staged' | 'unstaged') {
    const selection = buildGitDiffSelection(path, { status, scope })
    setSelectedDiff(selection)
    writeSelectedGitDiff(workspace, selection)
    navigate(buildGitDiffUrl(path, { status }))
  }

  function handleCommitFileClick(path: string, commit: string, status?: string) {
    const selection = buildGitDiffSelection(path, { commit, status })
    setSelectedDiff(selection)
    writeSelectedGitDiff(workspace, selection)
    navigate(buildGitDiffUrl(path, { commit, status }))
  }

  if (loading && !gitStatus) {
    return <div style={{ padding: 16, color: '#888' }}>Loading git status...</div>
  }

  if (!gitStatus) {
    return <div style={{ padding: 16, color: '#888' }}>{workspace ? 'No git repository found.' : 'No workspace selected.'}</div>
  }

  const staged = gitStatus.stagedFiles ?? []
  const unstaged = gitStatus.unstagedFiles ?? gitStatus.changedFiles ?? []
  const totalChanges = staged.length + unstaged.length

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px', paddingTop: 'calc(10px + env(safe-area-inset-top))',
        borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
      }}>
        <span style={{ fontSize: 14, color: '#d4d4d4', fontWeight: 600 }}>{gitStatus.branch || '(no branch)'}</span>
        {gitStatus.ahead > 0 && <span style={{ fontSize: 11, color: '#4ec9b0', background: '#1e3a1e', padding: '1px 6px', borderRadius: 4 }}>↑{gitStatus.ahead}</span>}
        {gitStatus.behind > 0 && <span style={{ fontSize: 11, color: '#f48771', background: '#3a1e1e', padding: '1px 6px', borderRadius: 4 }}>↓{gitStatus.behind}</span>}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#888' }}>{totalChanges} changed</span>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <PullToRefresh
          onRefresh={loadStatus}
          scrollKey="/git"
          restoreKey={`${staged.length}:${unstaged.length}:${commits.length}:${selectedDiff?.commit ? `${selectedDiff.commit}:${commitFiles[selectedDiff.commit] ? 'files' : 'loading'}` : 'worktree'}`}
        >
          {/* Current worktree changes */}
          {totalChanges === 0 && commits.length === 0 && (
            <div style={{ padding: 16, color: '#888', fontSize: 13 }}>No changes — working tree is clean.</div>
          )}

          {/* Staged files */}
          {staged.length > 0 && (
            <>
              <SectionHeader title="Staged" count={staged.length} color="#4ec9b0" />
              {staged.map(file => {
                const selection = buildGitDiffSelection(file.path, { status: file.status, scope: 'staged' })
                return (
                  <FileRow
                    key={'s:' + file.path}
                    file={file}
                    selected={selectedDiff?.key === selection.key}
                    onClick={() => handleFileClick(file.path, file.status, 'staged')}
                  />
                )
              })}
            </>
          )}

          {/* Unstaged files */}
          {unstaged.length > 0 && (
            <>
              <SectionHeader title={staged.length > 0 ? 'Unstaged' : 'Changes'} count={unstaged.length} color={staged.length > 0 ? '#e2b93d' : '#d4d4d4'} />
              {unstaged.map(file => {
                const selection = buildGitDiffSelection(file.path, { status: file.status, scope: 'unstaged' })
                return (
                  <FileRow
                    key={'u:' + file.path}
                    file={file}
                    selected={selectedDiff?.key === selection.key}
                    onClick={() => handleFileClick(file.path, file.status, 'unstaged')}
                  />
                )
              })}
            </>
          )}

          {/* Commit history */}
          {commits.length > 0 && (
            <>
              <SectionHeader title="Commits" count={commits.length} color="#888" />
              {commits.map(commit => (
                <div key={commit.hash}>
                  <button
                    onClick={() => handleExpandCommit(commit.hash)}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      width: '100%',
                      padding: '10px 14px',
                      background: expandedCommit === commit.hash ? '#252526' : 'none',
                      border: 'none',
                      borderBottom: '1px solid #2a2a2a',
                      cursor: 'pointer',
                      textAlign: 'left',
                      minHeight: 44,
                    }}
                  >
                    <span style={{ flexShrink: 0, fontSize: 11, color: '#569cd6', fontFamily: 'monospace', marginTop: 2 }}>
                      {commit.hashShort}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: '#d4d4d4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {commit.message.split('\n')[0]}
                      </div>
                      <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                        {commit.author}{commit.date ? ` · ${formatRelativeDate(commit.date)}` : ''}
                      </div>
                    </div>
                    <span style={{ fontSize: 11, color: '#888', flexShrink: 0 }}>{expandedCommit === commit.hash ? '▼' : '▶'}</span>
                  </button>
                  {/* Expanded: commit file list */}
                  {expandedCommit === commit.hash && (
                    <div style={{ background: '#1a1a1a' }}>
                      {!commitFiles[commit.hash] ? (
                        <div style={{ padding: '8px 14px', color: '#888', fontSize: 12 }}>Loading...</div>
                      ) : commitFiles[commit.hash].length === 0 ? (
                        <div style={{ padding: '8px 14px', color: '#888', fontSize: 12 }}>No files</div>
                      ) : (
                        commitFiles[commit.hash].map(file => (
                          <button
                            key={file.path}
                            onClick={() => handleCommitFileClick(file.path, commit.hash, file.status)}
                            style={{
                              display: 'flex',
                              gap: 8,
                              padding: '8px 14px 8px 40px',
                              borderBottom: '1px solid #222',
                              background: selectedDiff?.key === buildGitDiffSelection(file.path, { commit: commit.hash, status: file.status }).key ? '#252526' : 'none',
                              border: 'none',
                              borderLeft: selectedDiff?.key === buildGitDiffSelection(file.path, { commit: commit.hash, status: file.status }).key ? '2px solid #569cd6' : '2px solid transparent',
                              width: '100%',
                              textAlign: 'left',
                              cursor: 'pointer',
                              minHeight: 36,
                            }}
                          >
                            <span style={{ fontSize: 11, fontWeight: 700, color: STATUS_COLORS[file.status] ?? '#888', width: 14, flexShrink: 0 }}>
                              {STATUS_LABELS[file.status] ?? '?'}
                            </span>
                            <span style={{ fontSize: 12, color: '#aaa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                              {file.path}
                            </span>
                            <span style={{ fontSize: 11, color: '#555', flexShrink: 0 }}>›</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </PullToRefresh>
      </div>
    </div>
  )
}

function formatRelativeDate(isoDate: string): string {
  const date = new Date(isoDate)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 30) return `${diffDays}d ago`
  return date.toLocaleDateString()
}
