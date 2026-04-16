import { useLocation } from 'react-router'
import { Files, GitBranch, Map } from 'lucide-react'
import type { ComponentType } from 'react'

interface Tab {
  id: string
  path: string
  label: string
  icon: ComponentType<{ size?: number }>
}

const tabs: Tab[] = [
  { id: 'files', path: '/files', label: 'Files', icon: Files },
  { id: 'git', path: '/git', label: 'Git', icon: GitBranch },
  { id: 'tours', path: '/tours', label: 'Tours', icon: Map },
]

export function deriveActiveTab(pathname: string): string {
  for (const tab of tabs) {
    if (pathname.startsWith(tab.path)) return tab.id
  }
  return 'files'
}

export function ActivityBar({
  onTabClick,
  workspaceInitial,
  onWorkspaceClick,
}: {
  onTabClick: (path: string) => void
  workspaceInitial?: string
  onWorkspaceClick?: () => void
}) {
  const location = useLocation()
  const activeTab = deriveActiveTab(location.pathname)

  return (
    <nav
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: 48,
        height: '100%',
        background: '#252526',
        borderRight: '1px solid #333',
        flexShrink: 0,
      }}
    >
      {/* Tab icons */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => onTabClick(tab.path)}
              title={tab.label}
              style={{
                width: 48,
                height: 48,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'none',
                border: 'none',
                borderLeft: isActive ? '2px solid #569cd6' : '2px solid transparent',
                color: isActive ? '#fff' : '#888',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              <Icon size={20} />
            </button>
          )
        })}
      </div>

      {/* Workspace selector at bottom */}
      <button
        onClick={onWorkspaceClick}
        title="Switch workspace"
        style={{
          width: 48,
          height: 48,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'none',
          border: 'none',
          borderTop: '1px solid #333',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        <span
          style={{
            width: 28,
            height: 28,
            borderRadius: 4,
            background: '#3c3c3c',
            color: '#d4d4d4',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {workspaceInitial ?? '?'}
        </span>
      </button>
    </nav>
  )
}
