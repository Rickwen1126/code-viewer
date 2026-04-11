import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router'
import { useSwipeable } from 'react-swipeable'
import { useContext, useCallback, Component, type ReactNode, useEffect, useMemo } from 'react'
import { TabBar } from './components/tab-bar'
import { ConnectionStatus } from './components/connection-status'
import { WorkspaceProvider, useWorkspace } from './hooks/use-workspace'
import { TourEditProvider } from './hooks/use-tour-edit'
import { ReviewProvider, ReviewContext } from './hooks/use-review'
import { useWebSocket } from './hooks/use-websocket'
import { useDocumentVisibility } from './hooks/use-visibility'
import type { WatchDescriptor, WatchSyncPayload, WatchSyncResultPayload } from '@code-viewer/shared'
import { WorkspacesPage } from './pages/workspaces'
import { FileBrowserPage } from './pages/files/file-browser'
import { CodeViewerPage } from './pages/files/code-viewer'
import { GitChangesPage } from './pages/git'
import { GitDiffDetailPage } from './pages/git/diff-detail'
import { ChatSessionListPage } from './pages/chat'
import { ChatConversationPage } from './pages/chat/conversation'
import { TourListPage } from './pages/tours/index'
import { TourDetailPage } from './pages/tours/tour-detail'
import { PendingEditsListPage } from './pages/review'
import { EditDiffReviewPage } from './pages/review/edit-diff'
import { ToolApprovalPage } from './pages/review/tool-approval'

/** Smart redirect: restore last viewed file instead of always going to /workspaces */
function InitialRedirect() {
  const savedWorkspace = localStorage.getItem('code-viewer:selected-workspace')
  if (!savedWorkspace) return <Navigate to="/workspaces" replace />

  // Try per-workspace current file first, fallback to global
  let savedFile: string | null = null
  try {
    const ws = JSON.parse(savedWorkspace)
    savedFile = localStorage.getItem(`code-viewer:current-file:${ws.extensionId}`)
  } catch { /* ignore */ }
  if (!savedFile) savedFile = localStorage.getItem('code-viewer:current-file')

  if (savedFile) {
    const encoded = savedFile.split('/').map(encodeURIComponent).join('/')
    return <Navigate to={`/files/${encoded}`} replace />
  }

  return <Navigate to="/files" replace />
}

/** Root paths that are considered tab roots (depth 1). */
const TAB_ROOTS = new Set([
  '/workspaces',
  '/files',
  '/git',
  '/tours',
  '/chat',
  '/review',
])

function isTabRoot(pathname: string): boolean {
  // Matches exactly '/segment' — no further path parts
  const parts = pathname.split('/').filter(Boolean)
  return parts.length <= 1 && TAB_ROOTS.has('/' + (parts[0] ?? ''))
}

function decodeFileRoutePath(pathname: string): string | null {
  if (!pathname.startsWith('/files/')) return null
  const encoded = pathname.slice('/files/'.length)
  if (!encoded) return null
  return encoded.split('/').map(decodeURIComponent).join('/')
}

function WatchSyncController() {
  const location = useLocation()
  const { workspace } = useWorkspace()
  const { connectionState, request } = useWebSocket()
  const visibility = useDocumentVisibility()

  const watches = useMemo<WatchDescriptor[]>(() => {
    if (!workspace || visibility !== 'visible') return []

    const filePath = decodeFileRoutePath(location.pathname)
    if (filePath) {
      return [{ topic: 'file.content', path: filePath }]
    }

    if (location.pathname === '/git') {
      return [{ topic: 'git.status', scope: 'workspace' }]
    }

    return []
  }, [location.pathname, visibility, workspace])

  useEffect(() => {
    if (connectionState !== 'connected') return
    request<WatchSyncPayload, WatchSyncResultPayload>('watch.sync', { watches }).catch(() => {
      // Route/workspace/visibility changes or reconnect will retry.
    })
  }, [connectionState, request, watches, workspace])

  return null
}

function TabLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { totalBadgeCount } = useContext(ReviewContext)

  /** Navigate to a tab root using a crossfade view transition. */
  const navigateToTab = useCallback(
    (path: string) => {
      if ('startViewTransition' in document) {
        // Mark the transition as a tab switch so CSS can apply crossfade
        document.documentElement.classList.add('tab-transition')
        ;(document as Document & { startViewTransition: (cb: () => void) => { finished: Promise<void> } })
          .startViewTransition(() => {
            navigate(path)
          })
          .finished.finally(() => {
            document.documentElement.classList.remove('tab-transition')
          })
      } else {
        navigate(path)
      }
    },
    [navigate],
  )

  const swipeHandlers = useSwipeable({
    onSwipedRight: (e) => {
      // Only trigger from left edge (first 20px)
      if (e.initial[0] > 20) return
      // Only if we're in a sub-page (not a tab root)
      if (!isTabRoot(location.pathname)) {
        if ('startViewTransition' in document) {
          ;(document as Document & { startViewTransition: (cb: () => void) => void })
            .startViewTransition(() => {
              navigate(-1)
            })
        } else {
          navigate(-1)
        }
      }
    },
    trackMouse: false,
    delta: 100,
  })

  const badges: Record<string, number> = {}
  if (totalBadgeCount > 0) {
    badges['/review'] = totalBadgeCount
  }

  return (
    <div {...swipeHandlers} style={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
      <WatchSyncController />
      <ConnectionStatus />
      <main style={{ flex: 1, overflow: 'auto' }}>
        <Routes>
          <Route index element={<InitialRedirect />} />
          <Route path="workspaces" element={<WorkspacesPage />} />
          <Route path="files" element={<FileBrowserPage />} />
          <Route path="files/*" element={<CodeViewerPage />} />
          <Route path="git" element={<GitChangesPage />} />
          <Route path="git/diff/*" element={<GitDiffDetailPage />} />
          <Route path="tours" element={<TourListPage />} />
          <Route path="tours/:tourId" element={<TourDetailPage />} />
          <Route path="chat" element={<ChatSessionListPage />} />
          <Route path="chat/:sessionId" element={<ChatConversationPage />} />
          <Route path="review" element={<PendingEditsListPage />} />
          <Route path="review/edit/:editId" element={<EditDiffReviewPage />} />
          <Route path="review/tool/:requestId" element={<ToolApprovalPage />} />
        </Routes>
      </main>
      <TabBar badges={badges} onNavigate={navigateToTab} />
    </div>
  )
}

// Error Boundary: catches React crashes and shows recovery UI instead of gray screen
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: 24,
          paddingTop: 'calc(24px + env(safe-area-inset-top))',
          background: '#1e1e1e',
          color: '#d4d4d4',
          height: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
        }}>
          <div style={{ fontSize: 16, color: '#f48771' }}>Something went wrong</div>
          <div style={{ fontSize: 12, color: '#888', maxWidth: 300, textAlign: 'center', wordBreak: 'break-word' }}>
            {this.state.error.message}
          </div>
          <button
            onClick={() => {
              this.setState({ error: null })
              window.location.href = '/'
            }}
            style={{
              padding: '10px 24px',
              background: '#569cd6',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Reload App
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <WorkspaceProvider>
          <TourEditProvider>
            <ReviewProvider>
              <Routes>
                <Route path="/*" element={<TabLayout />} />
              </Routes>
            </ReviewProvider>
          </TourEditProvider>
        </WorkspaceProvider>
      </BrowserRouter>
    </ErrorBoundary>
  )
}
