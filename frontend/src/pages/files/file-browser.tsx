import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router'
import { useWebSocket } from '../../hooks/use-websocket'
import { wsClient } from '../../services/ws-client'
import { cacheService } from '../../services/cache'
import { useWorkspace } from '../../hooks/use-workspace'
import { PullToRefresh } from '../../components/pull-to-refresh'
import type { FileTreeNode, FileTreeResultPayload } from '@code-viewer/shared'

// Recursive tree node component
function TreeNode({
  node,
  depth,
  onFileClick,
}: {
  node: FileTreeNode
  depth: number
  onFileClick: (path: string) => void
}) {
  const [expanded, setExpanded] = useState(depth === 0)

  if (node.type === 'directory') {
    return (
      <div>
        <button
          onClick={() => setExpanded(!expanded)}
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
            <TreeNode key={child.path} node={child} depth={depth + 1} onFileClick={onFileClick} />
          ))}
      </div>
    )
  }

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
        background: 'none',
        border: 'none',
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

  useEffect(() => {
    if (connectionState !== 'connected' || !workspace) return
    loadTree()
    const unsub = wsClient.subscribe('file.treeChanged', () => loadTree())
    return unsub
  }, [connectionState, workspace])

  const loadTree = useCallback(async () => {
    try {
      setLoading(true)
      const res = await request<{ path?: string }, FileTreeResultPayload>('file.tree', {})
      setNodes(res.payload.nodes)
      // Update cache
      if (workspace) {
        cacheService.setFileTree(workspace.extensionId, res.payload.nodes)
      }
    } catch {
      // Try cache
      if (workspace) {
        const cached = await cacheService.getFileTree(workspace.extensionId)
        if (cached) setNodes(cached)
      }
    } finally {
      setLoading(false)
    }
  }, [request, workspace])

  function handleFileClick(path: string) {
    navigate(`/files/${encodeURIComponent(path)}`)
  }

  if (loading) return <div style={{ padding: 16, color: '#888' }}>Loading file tree...</div>

  return (
    <PullToRefresh onRefresh={loadTree}>
      <div style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        {nodes.map((node) => (
          <TreeNode key={node.path} node={node} depth={0} onFileClick={handleFileClick} />
        ))}
      </div>
    </PullToRefresh>
  )
}
