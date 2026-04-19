import { useState, useCallback } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router'
import { ActivityBar, deriveActiveTab } from './activity-bar'
import { SidebarPanel } from './sidebar-panel'
import { WorkspacePopover } from './workspace-popover'
import { FileBrowserSidebar } from './pages/file-browser-sidebar'
import { GitSidebar } from './pages/git-sidebar'
import { ToursSidebar } from './pages/tours-sidebar'
import { FilesLandingPage } from './pages/files-landing'
import { GitLandingPage } from './pages/git-landing'
import { ToursLandingPage } from './pages/tours-landing'
import { useWorkspace } from '../../hooks/use-workspace'
import { ConnectionStatus } from '../../components/connection-status'

// Main content pages — reuse existing mobile pages
import { CodeViewerPage } from '../../pages/files/code-viewer'
import { GitDiffDetailPage } from '../../pages/git/diff-detail'
import { TourDetailPage } from '../../pages/tours/tour-detail'
import { OpenFileResolverPage } from '../../pages/open/open-file'
import { OpenTourResolverPage } from '../../pages/open/open-tour'
import { OpenGitDiffResolverPage } from '../../pages/open/open-git-diff'

export function DesktopLayout() {
  const navigate = useNavigate()
  const location = useLocation()
  const { workspace } = useWorkspace()
  const activeTab = deriveActiveTab(location.pathname)
  const [showWorkspacePopover, setShowWorkspacePopover] = useState(false)

  const handleTabClick = useCallback(
    (path: string) => {
      navigate(path)
    },
    [navigate],
  )

  const handleWorkspaceClick = useCallback(() => {
    setShowWorkspacePopover(prev => !prev)
  }, [])

  const workspaceInitial = workspace?.name?.[0]?.toUpperCase()

  function renderSidebar() {
    switch (activeTab) {
      case 'files':
        return <FileBrowserSidebar />
      case 'git':
        return <GitSidebar />
      case 'tours':
        return <ToursSidebar />
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
        {showWorkspacePopover && (
          <WorkspacePopover onClose={() => setShowWorkspacePopover(false)} />
        )}
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
