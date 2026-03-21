import type React from 'react'

interface ActionSheetProps {
  isOpen: boolean
  onClose: () => void
  actions: Array<{ label: string; icon?: React.ReactNode; onClick: () => void }>
}

export function ActionSheet({ isOpen, onClose, actions }: ActionSheetProps) {
  if (!isOpen) return null
  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          zIndex: 100,
        }}
      />
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: '#252526',
          borderTopLeftRadius: 12,
          borderTopRightRadius: 12,
          padding: '8px 0',
          paddingBottom: 'env(safe-area-inset-bottom, 8px)',
          zIndex: 101,
        }}
      >
        {actions.map((action, i) => (
          <button
            key={i}
            onClick={() => {
              action.onClick()
              onClose()
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              width: '100%',
              padding: '14px 20px',
              background: 'none',
              border: 'none',
              color: '#d4d4d4',
              fontSize: 15,
              cursor: 'pointer',
              minHeight: 44,
            }}
          >
            {action.icon}
            {action.label}
          </button>
        ))}
        <button
          onClick={onClose}
          style={{
            width: '100%',
            padding: '14px 20px',
            background: 'none',
            border: 'none',
            color: '#888',
            fontSize: 15,
            cursor: 'pointer',
            marginTop: 4,
            borderTop: '1px solid #333',
            minHeight: 44,
          }}
        >
          Cancel
        </button>
      </div>
    </>
  )
}
