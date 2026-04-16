import { useMemo } from 'react'
import { useNavigate } from 'react-router'
import { buildFileLocationUrl, buildFileRoutePath } from '../../../services/file-location'
import { useWorkspace } from '../../../hooks/use-workspace'
import { getBookmarks, type Bookmark } from '../../../services/bookmarks'

const RECENT_FILES_KEY = 'code-viewer:recent-files'

function getRecentFiles(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_FILES_KEY) ?? '[]')
  } catch { return [] }
}

/** Landing page for /files on desktop — shows recent files and bookmarks in the main content area. */
export function FilesLandingPage() {
  const navigate = useNavigate()
  const { workspace } = useWorkspace()

  const recentFiles = useMemo(() => getRecentFiles(), [])
  const bookmarks = useMemo(
    () => workspace ? getBookmarks(workspace.extensionId) : [],
    [workspace],
  )

  return (
    <div style={{ padding: 32, maxWidth: 600, margin: '0 auto' }}>
      <h2 style={{ color: '#d4d4d4', fontSize: 18, fontWeight: 500, marginBottom: 24 }}>
        {workspace?.name ?? 'Code Viewer'}
      </h2>

      {/* Bookmarks */}
      {bookmarks.length > 0 && (
        <section style={{ marginBottom: 24 }}>
          <h3 style={{ fontSize: 11, color: '#e2b93d', textTransform: 'uppercase', marginBottom: 8, letterSpacing: 0.5 }}>
            Bookmarks
          </h3>
          {bookmarks.map((b: Bookmark) => (
            <button
              key={`${b.path}:${b.line}`}
              onClick={() => navigate(buildFileLocationUrl(b.path, { line: b.line }))}
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
                borderRadius: 4,
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#2a2d2e' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
            >
              <span style={{ color: '#e2b93d' }}>&#x2605; </span>
              <span style={{ color: '#569cd6' }}>{b.path.split('/').pop()}</span>
              <span style={{ color: '#888', marginLeft: 6, fontSize: 11 }}>{b.path.split('/').slice(0, -1).join('/')}</span>
              <span style={{ color: '#666', marginLeft: 6, fontSize: 11 }}>:{b.line}</span>
              {b.preview && (
                <div style={{ fontSize: 11, color: '#666', marginTop: 2, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {b.preview}
                </div>
              )}
            </button>
          ))}
        </section>
      )}

      {/* Recent files */}
      {recentFiles.length > 0 && (
        <section>
          <h3 style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', marginBottom: 8, letterSpacing: 0.5 }}>
            Recent Files
          </h3>
          {recentFiles.map((path) => (
            <button
              key={path}
              onClick={() => navigate(buildFileRoutePath(path))}
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
                borderRadius: 4,
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#2a2d2e' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'none' }}
            >
              <span style={{ color: '#569cd6' }}>{path.split('/').pop()}</span>
              <span style={{ color: '#666', marginLeft: 8, fontSize: 11 }}>{path.split('/').slice(0, -1).join('/')}</span>
            </button>
          ))}
        </section>
      )}

      {/* Empty state */}
      {recentFiles.length === 0 && bookmarks.length === 0 && (
        <div style={{ color: '#888', fontSize: 14 }}>
          Select a file from the sidebar to get started.
        </div>
      )}
    </div>
  )
}
