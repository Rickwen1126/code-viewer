import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router'
import { useWebSocket } from '../../hooks/use-websocket'
import { cacheService } from '../../services/cache'
import { useWorkspace } from '../../hooks/use-workspace'
import { PullToRefresh } from '../../components/pull-to-refresh'
import { getBookmarks, type Bookmark } from '../../services/bookmarks'
import type { FileTreeNode, FileTreeResultPayload } from '@code-viewer/shared'

const RECENT_FILES_KEY = 'code-viewer:recent-files'
const MAX_RECENT = 15

function getRecentFiles(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_FILES_KEY) ?? '[]')
  } catch { return [] }
}

export function addRecentFile(path: string): void {
  const recent = getRecentFiles().filter(p => p !== path)
  recent.unshift(path)
  if (recent.length > MAX_RECENT) recent.length = MAX_RECENT
  try { localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(recent)) } catch {}
}

// Flatten tree into file paths for search
function flattenFiles(nodes: FileTreeNode[], prefix = ''): { path: string; name: string }[] {
  const result: { path: string; name: string }[] = []
  for (const node of nodes) {
    if (node.type === 'file') {
      result.push({ path: node.path, name: node.name })
    } else if (node.children) {
      result.push(...flattenFiles(node.children, node.path + '/'))
    }
  }
  return result
}

// Simple fuzzy match: all query chars appear in order in target
function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  return qi === q.length
}

const EXPANDED_KEY = 'code-viewer:expanded-dirs'

function getExpandedDirs(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '[]'))
  } catch { return new Set() }
}

function saveExpandedDirs(dirs: Set<string>): void {
  try { localStorage.setItem(EXPANDED_KEY, JSON.stringify([...dirs])) } catch {}
}

// Recursive tree node component
function TreeNode({
  node,
  depth,
  onFileClick,
  expandedDirs,
  onToggle,
  currentFile,
}: {
  node: FileTreeNode
  depth: number
  onFileClick: (path: string) => void
  expandedDirs: Set<string>
  onToggle: (path: string) => void
  currentFile: string | null
}) {
  if (node.type === 'directory') {
    const expanded = expandedDirs.has(node.path)
    return (
      <div>
        <button
          onClick={() => onToggle(node.path)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            width: '100%',
            padding: '8px 12px',
            paddingLeft: 12 + depth * 16,
            background: 'none',
            border: 'none',
            color: '#d4d4d4',
            fontSize: 14,
            cursor: 'pointer',
            textAlign: 'left',
            minHeight: 36,
          }}
        >
          <span style={{ fontSize: 10, color: '#888' }}>{expanded ? '▼' : '▶'}</span>
          <span style={{ color: '#dcb67a' }}>{node.name}</span>
        </button>
        {expanded &&
          node.children?.map((child) => (
            <TreeNode key={child.path} node={child} depth={depth + 1} onFileClick={onFileClick} expandedDirs={expandedDirs} onToggle={onToggle} currentFile={currentFile} />
          ))}
      </div>
    )
  }

  const isCurrentFile = currentFile === node.path
  return (
    <button
      onClick={() => onFileClick(node.path)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        width: '100%',
        padding: '8px 12px',
        paddingLeft: 28 + depth * 16,
        background: isCurrentFile ? '#2a2d2e' : 'none',
        border: 'none',
        borderLeft: isCurrentFile ? '2px solid #569cd6' : '2px solid transparent',
        color: node.isGitIgnored ? '#666' : '#d4d4d4',
        fontSize: 14,
        cursor: 'pointer',
        textAlign: 'left',
        minHeight: 36,
      }}
    >
      <span>{node.name}</span>
      {node.isDirty && <span style={{ color: '#e2b93d', fontSize: 8 }}>●</span>}
    </button>
  )
}

export function FileBrowserPage() {
  const { request, connectionState } = useWebSocket()
  const { workspace } = useWorkspace()
  const navigate = useNavigate()
  const [nodes, setNodes] = useState<FileTreeNode[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [showRecent, setShowRecent] = useState(false)
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => getExpandedDirs())
  const [collapsedSnapshot, setCollapsedSnapshot] = useState<Set<string> | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Current file from localStorage (set by code-viewer)
  const currentFile = localStorage.getItem('code-viewer:current-file')

  function handleToggle(path: string) {
    setExpandedDirs(prev => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      saveExpandedDirs(next)
      return next
    })
  }

  function collapseAll() {
    setCollapsedSnapshot(new Set(expandedDirs))
    setExpandedDirs(new Set())
    saveExpandedDirs(new Set())
  }

  function recoverState() {
    if (!collapsedSnapshot) return
    setExpandedDirs(collapsedSnapshot)
    saveExpandedDirs(collapsedSnapshot)
    setCollapsedSnapshot(null)
  }

  // Auto-expand to current file on mount
  useEffect(() => {
    if (!currentFile || nodes.length === 0) return
    const parts = currentFile.split('/')
    const dirs: string[] = []
    for (let i = 0; i < parts.length - 1; i++) {
      dirs.push(parts.slice(0, i + 1).join('/'))
    }
    if (dirs.length > 0) {
      setExpandedDirs(prev => {
        const next = new Set(prev)
        let changed = false
        for (const d of dirs) {
          if (!next.has(d)) { next.add(d); changed = true }
        }
        if (changed) saveExpandedDirs(next)
        return changed ? next : prev
      })
    }
  }, [currentFile, nodes])

  // Flatten tree for search
  const allFiles = useMemo(() => flattenFiles(nodes), [nodes])
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return []
    return allFiles.filter(f => fuzzyMatch(searchQuery, f.path)).slice(0, 20)
  }, [searchQuery, allFiles])

  const recentFiles = useMemo(() => getRecentFiles(), [nodes]) // re-read when tree changes
  const bookmarks = useMemo(
    () => workspace ? getBookmarks(workspace.extensionId) : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspace, showRecent], // re-read when dropdown opens
  )

  // Redirect to workspace selection if no workspace ever selected
  useEffect(() => {
    if (!workspace && connectionState === 'connected') {
      navigate('/workspaces', { replace: true })
    }
  }, [workspace, connectionState, navigate])

  // Cache-first: immediately show cached file tree
  useEffect(() => {
    if (!workspace) return
    cacheService.getFileTree(workspace.extensionId).then(cached => {
      if (cached && cached.length > 0) {
        setNodes(cached)
        setLoading(false)
      }
    })
  }, [workspace])

  // Background fetch on connect (no spinner if we have cached data)
  useEffect(() => {
    if (connectionState !== 'connected' || !workspace) return
    loadTreeBackground()
  }, [connectionState, workspace])

  // Background load: silently update, no spinner
  const loadTreeBackground = useCallback(async () => {
    try {
      const res = await request<{ path?: string }, FileTreeResultPayload>('file.tree', {})
      const nodes = res.payload?.nodes
      if (Array.isArray(nodes)) {
        setNodes(nodes)
        if (workspace) {
          cacheService.setFileTree(workspace.extensionId, nodes)
        }
      }
    } catch {
      // Already showing cached data — ignore
    } finally {
      setLoading(false)
    }
  }, [request, workspace])

  // Full load with spinner (for PullToRefresh only)
  const loadTree = useCallback(async () => {
    setLoading(true)
    await loadTreeBackground()
  }, [loadTreeBackground])

  function handleFileClick(path: string) {
    addRecentFile(path)
    setSearchQuery('')
    setShowRecent(false)
    navigate(`/files/${encodeURIComponent(path)}`)
  }

  if (loading && nodes.length === 0) return <div style={{ padding: 16, color: '#888' }}>Loading file tree...</div>

  const isSearching = searchQuery.trim().length > 0

  return (
    <PullToRefresh onRefresh={loadTree}>
      <div style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        {/* Search bar */}
        <div style={{
          padding: '8px 12px',
          borderBottom: '1px solid #333',
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          position: 'sticky',
          top: 0,
          background: '#1e1e1e',
          zIndex: 10,
        }}>
          <input
            ref={searchRef}
            type="text"
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setShowRecent(false) }}
            onFocus={() => { if (!searchQuery) setShowRecent(true) }}
            onBlur={() => setTimeout(() => setShowRecent(false), 200)}
            style={{
              flex: 1,
              background: '#2a2a2a',
              border: '1px solid #444',
              borderRadius: 6,
              padding: '8px 12px',
              color: '#d4d4d4',
              fontSize: 14,
              outline: 'none',
            }}
          />
          {(isSearching || showRecent) && (
            <button
              onClick={() => { setSearchQuery(''); setShowRecent(false); searchRef.current?.blur() }}
              style={{ background: 'none', border: 'none', color: '#888', fontSize: 14, cursor: 'pointer', padding: '4px 8px' }}
            >
              Cancel
            </button>
          )}
        </div>

        {/* Bookmarks (shown on focus when no query) */}
        {showRecent && !isSearching && bookmarks.length > 0 && (
          <div style={{ borderBottom: '1px solid #333' }}>
            <div style={{ padding: '6px 12px', fontSize: 11, color: '#e2b93d', textTransform: 'uppercase' }}>
              &#x2605; Bookmarks ({bookmarks.length})
            </div>
            {bookmarks.map((b: Bookmark) => (
              <button
                key={`${b.path}:${b.line}`}
                onClick={() => {
                  setSearchQuery('')
                  setShowRecent(false)
                  const encoded = b.path.split('/').map(encodeURIComponent).join('/')
                  navigate(`/files/${encoded}`, { state: { scrollToLine: b.line - 1 } })
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '8px 12px',
                  background: 'none',
                  border: 'none',
                  borderBottom: '1px solid #2a2a2a',
                  color: '#d4d4d4',
                  fontSize: 13,
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <div>
                  <span style={{ color: '#e2b93d' }}>&#x2605; </span>
                  <span style={{ color: '#569cd6' }}>{b.path.split('/').pop()}</span>
                  <span style={{ color: '#888', marginLeft: 6, fontSize: 11 }}>
                    {b.path.split('/').slice(0, -1).join('/')}
                  </span>
                  <span style={{ color: '#666', marginLeft: 6, fontSize: 11 }}>:{b.line}</span>
                </div>
                {b.preview && (
                  <div style={{ fontSize: 11, color: '#666', marginTop: 2, fontFamily: "'JetBrains Mono', monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {b.preview}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Recent files (shown on focus when no query) */}
        {showRecent && !isSearching && recentFiles.length > 0 && (
          <div style={{ borderBottom: '1px solid #333' }}>
            <div style={{ padding: '6px 12px', fontSize: 11, color: '#888', textTransform: 'uppercase' }}>Recent</div>
            {recentFiles.map((path) => (
              <button
                key={path}
                onClick={() => handleFileClick(path)}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '10px 12px',
                  background: 'none',
                  border: 'none',
                  borderBottom: '1px solid #2a2a2a',
                  color: '#d4d4d4',
                  fontSize: 13,
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <span style={{ color: '#569cd6' }}>{path.split('/').pop()}</span>
                <span style={{ color: '#666', marginLeft: 8, fontSize: 11 }}>
                  {path.split('/').slice(0, -1).join('/')}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Search results */}
        {isSearching && (
          <div>
            {searchResults.length === 0 ? (
              <div style={{ padding: 16, color: '#888', fontSize: 13 }}>No files found</div>
            ) : (
              searchResults.map((f) => (
                <button
                  key={f.path}
                  onClick={() => handleFileClick(f.path)}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '10px 12px',
                    background: 'none',
                    border: 'none',
                    borderBottom: '1px solid #2a2a2a',
                    color: '#d4d4d4',
                    fontSize: 13,
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ color: '#569cd6' }}>{f.name}</span>
                  <span style={{ color: '#666', marginLeft: 8, fontSize: 11 }}>
                    {f.path.split('/').slice(0, -1).join('/')}
                  </span>
                </button>
              ))
            )}
          </div>
        )}

        {/* File tree (hidden during search) */}
        {!isSearching && !showRecent && (
          <>
            {/* Workspace name + Collapse All / Recovery */}
            <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #2a2a2a' }}>
              {workspace && (
                <span style={{ padding: '6px 12px', fontSize: 11, color: '#569cd6', fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {workspace.name}
                </span>
              )}
              <div style={{ display: 'flex', marginLeft: 'auto' }}>
                {collapsedSnapshot && (
                  <button
                    onClick={recoverState}
                    style={{
                      padding: '6px 12px',
                      background: 'none',
                      border: 'none',
                      color: '#569cd6',
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    Recovery
                  </button>
                )}
                {expandedDirs.size > 0 && (
                  <button
                    onClick={collapseAll}
                    style={{
                      padding: '6px 12px',
                      background: 'none',
                      border: 'none',
                      color: '#888',
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    Collapse All
                  </button>
                )}
              </div>
            </div>
            {(nodes ?? []).map((node) => (
              <TreeNode key={node.path} node={node} depth={0} onFileClick={handleFileClick} expandedDirs={expandedDirs} onToggle={handleToggle} currentFile={currentFile} />
            ))}
          </>
        )}
      </div>
    </PullToRefresh>
  )
}
