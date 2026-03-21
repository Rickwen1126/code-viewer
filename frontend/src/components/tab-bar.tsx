import { useLocation, useNavigate } from 'react-router'
import { FolderGit2, Files, GitBranch, Map, MessageSquare, FileCheck } from 'lucide-react'

const tabs = [
  { path: '/workspaces', label: 'Workspaces', icon: FolderGit2 },
  { path: '/files', label: 'Files', icon: Files },
  { path: '/git', label: 'Git', icon: GitBranch },
  { path: '/tours', label: 'Tours', icon: Map },
  { path: '/chat', label: 'Chat', icon: MessageSquare },
  { path: '/review', label: 'Review', icon: FileCheck },
]

export function TabBar({
  badges,
  onNavigate,
}: {
  badges?: Record<string, number>
  onNavigate?: (path: string) => void
}) {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <nav
      style={{
        display: 'flex',
        height: 56,
        paddingBottom: 'env(safe-area-inset-bottom)',
        background: '#1e1e1e',
        borderTop: '1px solid #333',
      }}
    >
      {tabs.map((tab) => {
        const isActive = location.pathname.startsWith(tab.path)
        const Icon = tab.icon
        const badge = badges?.[tab.path]
        return (
          <button
            key={tab.path}
            onClick={() => (onNavigate ?? navigate)(tab.path)}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              background: 'none',
              border: 'none',
              color: isActive ? '#569cd6' : '#888',
              fontSize: 10,
              padding: 0,
              cursor: 'pointer',
              position: 'relative',
              minHeight: 44,
            }}
          >
            <Icon size={22} />
            <span>{tab.label}</span>
            {badge !== undefined && badge > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: 4,
                  right: '50%',
                  transform: 'translateX(12px)',
                  background: '#e74c3c',
                  color: '#fff',
                  borderRadius: 8,
                  fontSize: 10,
                  padding: '0 5px',
                  minWidth: 16,
                  textAlign: 'center',
                  lineHeight: '16px',
                }}
              >
                {badge}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
