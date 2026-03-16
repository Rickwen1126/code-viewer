import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router'
import { useSwipeable } from 'react-swipeable'
import { useContext } from 'react'
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

function TabLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { totalBadgeCount } = useContext(ReviewContext)

  const swipeHandlers = useSwipeable({
    onSwipedRight: (e) => {
      // Only trigger from left edge (first 20px)
      if (e.initial[0] > 20) return
      // Only if we're in a sub-page (not a tab root)
      const isSubPage = location.pathname.split('/').filter(Boolean).length > 1
      if (isSubPage) {
        navigate(-1)
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
      <TabBar badges={badges} />
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
