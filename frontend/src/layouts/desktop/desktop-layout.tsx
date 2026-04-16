import { useCallback } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router'
import { ActivityBar, deriveActiveTab } from './activity-bar'
import { SidebarPanel } from './sidebar-panel'
import { FileBrowserSidebar } from './pages/file-browser-sidebar'
import { FilesLandingPage } from './pages/files-landing'
import { GitLandingPage } from './pages/git-landing'
import { ToursLandingPage } from './pages/tours-landing'
import { useWorkspace } from '../../hooks/use-workspace'
import { ConnectionStatus } from '../../components/connection-status'

// Main content pages — reuse existing mobile pages for now
import { CodeViewerPage } from '../../pages/files/code-viewer'
import { GitChangesPage } from '../../pages/git'
import { GitDiffDetailPage } from '../../pages/git/diff-detail'
import { TourListPage } from '../../pages/tours/index'
import { TourDetailPage } from '../../pages/tours/tour-detail'
import { OpenFileResolverPage } from '../../pages/open/open-file'
import { OpenTourResolverPage } from '../../pages/open/open-tour'
import { OpenGitDiffResolverPage } from '../../pages/open/open-git-diff'

export function DesktopLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { workspace } = useWorkspace()
  const activeTab = deriveActiveTab(location.pathname)

  const handleTabClick = useCallback(
    (path: string) => {
      navigate(path)
    },
    [navigate],
  )

  const handleWorkspaceClick = useCallback(() => {
    navigate('/workspaces')
  }, [navigate])

  const workspaceInitial = workspace?.name?.[0]?.toUpperCase()

  // Sidebar content based on active tab
  // Phase 1: Files has its own desktop sidebar; Git and Tours use mobile pages temporarily
  function renderSidebar() {
    switch (activeTab) {
      case 'files':
        return <FileBrowserSidebar />
      case 'git':
        // Temporary: reuse mobile GitChangesPage in sidebar until git-sidebar is forked
        return <GitChangesPage />
      case 'tours':
        // Temporary: reuse mobile TourListPage in sidebar until tours-sidebar is forked
        return <TourListPage />
      default:
        return <FileBrowserSidebar />
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
      <ConnectionStatus />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <ActivityBar
          onTabClick={handleTabClick}
          workspaceInitial={workspaceInitial}
          onWorkspaceClick={handleWorkspaceClick}
        />
        <SidebarPanel>
          {renderSidebar()}
        </SidebarPanel>
        <main style={{ flex: 1, overflow: 'auto' }}>
          <Routes>
            {/* Files */}
            <Route path="files" element={<FilesLandingPage />} />
            <Route path="files/*" element={<CodeViewerPage />} />

            {/* Git */}
            <Route path="git" element={<GitLandingPage />} />
            <Route path="git/diff/*" element={<GitDiffDetailPage />} />

            {/* Tours */}
            <Route path="tours" element={<ToursLandingPage />} />
            <Route path="tours/:tourId" element={<TourDetailPage />} />

            {/* Deep link resolvers — render in main, sidebar stays stable */}
            <Route path="open/file" element={<OpenFileResolverPage />} />
            <Route path="open/tour" element={<OpenTourResolverPage />} />
            <Route path="open/git-diff" element={<OpenGitDiffResolverPage />} />

            {/* Fallback */}
            <Route path="workspaces" element={<FilesLandingPage />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}
