import type { LspReferencesResultPayload } from '@code-viewer/shared'

interface ReferencesListProps {
  isOpen: boolean
  onClose: () => void
  references: LspReferencesResultPayload['locations']
  onNavigate: (path: string, line: number) => void
}

export function ReferencesList({ isOpen, onClose, references, onNavigate }: ReferencesListProps) {
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
          maxHeight: '60vh',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 101,
          paddingBottom: 'env(safe-area-inset-bottom, 8px)',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid #333',
            flexShrink: 0,
          }}
        >
          <span style={{ color: '#d4d4d4', fontSize: 14, fontWeight: 600 }}>
            References ({references.length})
          </span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#888',
              fontSize: 18,
              cursor: 'pointer',
              padding: '0 4px',
            }}
          >
            ✕
          </button>
        </div>

        {/* List */}
        <div style={{ overflow: 'auto', flex: 1 }}>
          {references.length === 0 ? (
            <div style={{ padding: 16, color: '#888', fontSize: 13, textAlign: 'center' }}>
              No references found
            </div>
          ) : (
            references.map((ref, i) => (
              <button
                key={i}
                onClick={() => {
                  onNavigate(ref.path, ref.range.start.line)
                  onClose()
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '10px 16px',
                  background: 'none',
                  border: 'none',
                  borderBottom: '1px solid #2d2d2d',
                  cursor: 'pointer',
                  textAlign: 'left',
                  minHeight: 44,
                }}
              >
                <div style={{ color: '#569cd6', fontSize: 12, marginBottom: 2 }}>
                  {ref.path}:{ref.range.start.line + 1}
                </div>
                {ref.preview && (
                  <div
                    style={{
                      color: '#888',
                      fontSize: 12,
                      fontFamily: "'JetBrains Mono', monospace",
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {ref.preview}
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </>
  )
}
