/**
 * Desktop sidebar variant of FileBrowserPage.
 * Forked from pages/files/file-browser.tsx — same data logic, compact layout, no pull-to-refresh.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router'
import { useWebSocket } from '../../../hooks/use-websocket'
import { cacheService } from '../../../services/cache'
import { buildFileLocationUrl, buildFileRoutePath } from '../../../services/file-location'
import { readCurrentFileForWorkspace } from '../../../services/current-file'
import { useWorkspace } from '../../../hooks/use-workspace'
import { addRecentFile, getRecentFiles } from '../../../pages/files/file-browser'
import { getBookmarks, type Bookmark } from '../../../services/bookmarks'
import type { FileTreeNode, FileTreeResultPayload } from '@code-viewer/shared'

function flattenFiles(nodes: FileTreeNode[]): { path: string; name: string }[] {
  const result: { path: string; name: string }[] = []
  for (const node of nodes) {
    if (node.type === 'file') {
      result.push({ path: node.path, name: node.name })
    } else if (node.children) {
      result.push(...flattenFiles(node.children))
    }
  }
  return result
}

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

// Desktop tree node — compact sizing, hover states
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
            gap: 4,
            width: '100%',
            padding: '4px 8px',
            paddingLeft: 8 + depth * 14,
            background: 'none',
            border: 'none',
            color: '#d4d4d4',
            fontSize: 13,
            cursor: 'pointer',
            textAlign: 'left',
            minHeight: 28,
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#2a2d2e' }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
        >
          <span style={{ fontSize: 9, color: '#888', width: 10 }}>{expanded ? '▼' : '▶'}</span>
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
        gap: 4,
        width: '100%',
        padding: '4px 8px',
        paddingLeft: 22 + depth * 14,
        background: isCurrentFile ? '#2a2d2e' : 'none',
        border: 'none',
        borderLeft: isCurrentFile ? '2px solid #569cd6' : '2px solid transparent',
        color: node.isGitIgnored ? '#666' : '#d4d4d4',
        fontSize: 13,
        cursor: 'pointer',
        textAlign: 'left',
        minHeight: 28,
      }}
      onMouseEnter={(e) => { if (!isCurrentFile) (e.currentTarget as HTMLElement).style.background = '#2a2d2e' }}
      onMouseLeave={(e) => { if (!isCurrentFile) (e.currentTarget as HTMLElement).style.background = 'none' }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.name}</span>
      {node.isDirty && <span style={{ color: '#e2b93d', fontSize: 8, flexShrink: 0 }}>●</span>}
    </button>
  )
}

export function FileBrowserSidebar() {
  const { request, connectionState } = useWebSocket()
  const { workspace, workspaceReady } = useWorkspace()
  const navigate = useNavigate()
  const location = useLocation()
  const [nodes, setNodes] = useState<FileTreeNode[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [showRecent, setShowRecent] = useState(false)
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => getExpandedDirs())
  const [collapsedSnapshot, setCollapsedSnapshot] = useState<Set<string> | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const currentFile = readCurrentFileForWorkspace(workspace)

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

  const allFiles = useMemo(() => flattenFiles(nodes), [nodes])
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return []
    return allFiles.filter(f => fuzzyMatch(searchQuery, f.path)).slice(0, 20)
  }, [searchQuery, allFiles])

  const recentFiles = useMemo(() => getRecentFiles(workspace?.extensionId), [nodes, workspace])
  const bookmarks = useMemo(
    () => workspace ? getBookmarks(workspace.extensionId) : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspace, showRecent],
  )

  // Skip redirect when a resolver page (/open/*) is handling workspace selection
  useEffect(() => {
    if (!workspace && connectionState === 'connected' && !location.pathname.startsWith('/open/')) {
      navigate('/workspaces', { replace: true })
    }
  }, [workspace, connectionState, navigate, location.pathname])

  useEffect(() => {
    if (!workspace) return
    cacheService.getFileTree(workspace.extensionId).then(cached => {
      if (cached && cached.length > 0) {
        setNodes(cached)
        setLoading(false)
      }
    })
  }, [workspace])

  useEffect(() => {
    if (connectionState !== 'connected' || !workspace || !workspaceReady) return
    loadTreeBackground()
  }, [connectionState, workspace, workspaceReady])

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
      // Already showing cached data
    } finally {
      setLoading(false)
    }
  }, [request, workspace])

  function handleFileClick(path: string) {
    addRecentFile(path, workspace?.extensionId)
    setSearchQuery('')
    setShowRecent(false)
    navigate(buildFileRoutePath(path))
  }

  if (loading && nodes.length === 0) {
    return <div style={{ padding: 12, color: '#888', fontSize: 13 }}>Loading...</div>
  }

  const isSearching = searchQuery.trim().length > 0

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Search bar — compact */}
      <div style={{
        padding: '6px 8px',
        borderBottom: '1px solid #333',
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
          onChange={(e) => { setSearchQuery(e.target.value); setShowRecent(!e.target.value.trim()) }}
          onFocus={() => { if (!searchQuery) setShowRecent(true) }}
          onBlur={() => setTimeout(() => setShowRecent(false), 200)}
          style={{
            width: '100%',
            background: '#2a2a2a',
            border: '1px solid #444',
            borderRadius: 4,
            padding: '5px 8px',
            color: '#d4d4d4',
            fontSize: 12,
            outline: 'none',
          }}
        />
      </div>

      {/* Content area — scrollable */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {/* Bookmarks dropdown (shown on focus when no query) */}
        {showRecent && !isSearching && bookmarks.length > 0 && (
          <div style={{ borderBottom: '1px solid #333' }}>
            <div style={{ padding: '4px 8px', fontSize: 10, color: '#e2b93d', textTransform: 'uppercase' }}>
              &#x2605; Bookmarks ({bookmarks.length})
            </div>
            {bookmarks.map((b: Bookmark) => (
              <button
                key={`${b.path}:${b.line}`}
                onClick={() => {
                  setSearchQuery('')
                  setShowRecent(false)
                  navigate(buildFileLocationUrl(b.path, { line: b.line }))
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '6px 8px',
                  background: 'none',
                  border: 'none',
                  borderBottom: '1px solid #2a2a2a',
                  color: '#d4d4d4',
                  fontSize: 12,
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#2a2d2e' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
              >
                <span style={{ color: '#e2b93d' }}>&#x2605; </span>
                <span style={{ color: '#569cd6' }}>{b.path.split('/').pop()}</span>
                <span style={{ color: '#666', marginLeft: 6, fontSize: 11 }}>:{b.line}</span>
                {b.preview && (
                  <div style={{ fontSize: 10, color: '#666', marginTop: 1, fontFamily: "'JetBrains Mono', monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {b.preview}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}

        {/* Recent files dropdown (shown on focus when no query) */}
        {showRecent && !isSearching && recentFiles.length > 0 && (
          <div style={{ borderBottom: '1px solid #333' }}>
            <div style={{ padding: '4px 8px', fontSize: 10, color: '#888', textTransform: 'uppercase' }}>Recent</div>
            {recentFiles.map((path) => (
              <button
                key={path}
                onClick={() => handleFileClick(path)}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '6px 8px',
                  background: 'none',
                  border: 'none',
                  borderBottom: '1px solid #2a2a2a',
                  color: '#d4d4d4',
                  fontSize: 12,
                  textAlign: 'left',
                  cursor: 'pointer',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#2a2d2e' }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
              >
                <span style={{ color: '#569cd6' }}>{path.split('/').pop()}</span>
                <span style={{ color: '#666', marginLeft: 6, fontSize: 11 }}>
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
              <div style={{ padding: 12, color: '#888', fontSize: 12 }}>No files found</div>
            ) : (
              searchResults.map((f) => (
                <button
                  key={f.path}
                  onClick={() => handleFileClick(f.path)}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '6px 8px',
                    background: 'none',
                    border: 'none',
                    borderBottom: '1px solid #2a2a2a',
                    color: '#d4d4d4',
                    fontSize: 12,
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#2a2d2e' }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
                >
                  <span style={{ color: '#569cd6' }}>{f.name}</span>
                  <span style={{ color: '#666', marginLeft: 6, fontSize: 11 }}>
                    {f.path.split('/').slice(0, -1).join('/')}
                  </span>
                </button>
              ))
            )}
          </div>
        )}

        {/* File tree (hidden during search or recent dropdown) */}
        {!isSearching && !showRecent && (
          <>
            {/* Header: workspace name + actions */}
            <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #2a2a2a', minHeight: 26 }}>
              {workspace && (
                <span style={{ padding: '4px 8px', fontSize: 11, color: '#569cd6', fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {workspace.name}
                </span>
              )}
              <div style={{ display: 'flex', marginLeft: 'auto' }}>
                {collapsedSnapshot && (
                  <button
                    onClick={recoverState}
                    style={{ padding: '4px 8px', background: 'none', border: 'none', color: '#569cd6', fontSize: 10, cursor: 'pointer' }}
                  >
                    Recovery
                  </button>
                )}
                {expandedDirs.size > 0 && (
                  <button
                    onClick={collapseAll}
                    style={{ padding: '4px 8px', background: 'none', border: 'none', color: '#888', fontSize: 10, cursor: 'pointer' }}
                  >
                    Collapse
                  </button>
                )}
              </div>
            </div>

            {/* Tree */}
            {(nodes ?? []).map((node) => (
              <TreeNode key={node.path} node={node} depth={0} onFileClick={handleFileClick} expandedDirs={expandedDirs} onToggle={handleToggle} currentFile={currentFile} />
            ))}

            {/* Bookmarks section */}
            {bookmarks.length > 0 && (
              <div style={{ borderTop: '1px solid #333', marginTop: 8 }}>
                <div style={{ padding: '6px 8px', fontSize: 10, color: '#e2b93d', textTransform: 'uppercase' }}>
                  &#x2605; Bookmarks ({bookmarks.length})
                </div>
                {bookmarks.map((b: Bookmark) => (
                  <button
                    key={`${b.path}:${b.line}`}
                    onClick={() => navigate(buildFileLocationUrl(b.path, { line: b.line }))}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: '4px 8px',
                      background: 'none',
                      border: 'none',
                      color: '#d4d4d4',
                      fontSize: 12,
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#2a2d2e' }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
                  >
                    <span style={{ color: '#e2b93d' }}>&#x2605; </span>
                    <span style={{ color: '#569cd6' }}>{b.path.split('/').pop()}</span>
                    <span style={{ color: '#666', marginLeft: 4, fontSize: 10 }}>:{b.line}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Recent files section */}
            {recentFiles.length > 0 && (
              <div style={{ borderTop: '1px solid #333', marginTop: 4 }}>
                <div style={{ padding: '6px 8px', fontSize: 10, color: '#888', textTransform: 'uppercase' }}>
                  Recent
                </div>
                {recentFiles.slice(0, 8).map((path) => (
                  <button
                    key={path}
                    onClick={() => handleFileClick(path)}
                    style={{
                      display: 'block',
                      width: '100%',
                      padding: '4px 8px',
                      background: 'none',
                      border: 'none',
                      color: '#d4d4d4',
                      fontSize: 12,
                      textAlign: 'left',
                      cursor: 'pointer',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#2a2d2e' }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
                  >
                    <span style={{ color: '#569cd6' }}>{path.split('/').pop()}</span>
                    <span style={{ color: '#666', marginLeft: 4, fontSize: 10 }}>
                      {path.split('/').slice(0, -1).join('/')}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
