import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router'
import { useSwipeable } from 'react-swipeable'
import { useContext, useCallback } from 'react'
import { TabBar } from './components/tab-bar'
import { ConnectionStatus } from './components/connection-status'
import { WorkspaceProvider } from './hooks/use-workspace'
import { ReviewProvider, ReviewContext } from './hooks/use-review'
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
      <ConnectionStatus />
      <main style={{ flex: 1, overflow: 'auto' }}>
        <Routes>
          <Route index element={<Navigate to="/workspaces" replace />} />
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

export default function App() {
  return (
    <BrowserRouter>
      <WorkspaceProvider>
        <ReviewProvider>
          <Routes>
            <Route path="/*" element={<TabLayout />} />
          </Routes>
        </ReviewProvider>
      </WorkspaceProvider>
    </BrowserRouter>
  )
}
