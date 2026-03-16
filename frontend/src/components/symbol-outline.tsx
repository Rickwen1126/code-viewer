import type { LspSymbol } from '@code-viewer/shared'

interface SymbolOutlineProps {
  isOpen: boolean
  onClose: () => void
  symbols: LspSymbol[]
  onNavigate: (line: number) => void
}

const KIND_ICONS: Record<string, string> = {
  file: '📄',
  module: '📦',
  namespace: '🔷',
  package: '📦',
  class: 'C',
  method: 'M',
  property: 'P',
  field: 'F',
  constructor: 'C',
  enum: 'E',
  interface: 'I',
  function: 'ƒ',
  variable: 'V',
  constant: 'C',
  string: 'S',
  number: 'N',
  boolean: 'B',
  array: 'A',
  object: 'O',
  key: 'K',
  null: '∅',
  enummember: 'E',
  struct: 'S',
  event: 'E',
  operator: '±',
  typeparameter: 'T',
}

function SymbolItem({
  symbol,
  depth,
  onNavigate,
  onClose,
}: {
  symbol: LspSymbol
  depth: number
  onNavigate: (line: number) => void
  onClose: () => void
}) {
  const icon = KIND_ICONS[symbol.kind] ?? '·'

  return (
    <>
      <button
        onClick={() => {
          onNavigate(symbol.range.start.line)
          onClose()
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          padding: `10px 16px 10px ${16 + depth * 16}px`,
          background: 'none',
          border: 'none',
          borderBottom: '1px solid #2d2d2d',
          cursor: 'pointer',
          textAlign: 'left',
          minHeight: 40,
        }}
      >
        <span
          style={{
            fontSize: 11,
            color: '#888',
            fontFamily: "'JetBrains Mono', monospace",
            minWidth: 14,
            textAlign: 'center',
          }}
        >
          {icon}
        </span>
        <span style={{ color: '#d4d4d4', fontSize: 13 }}>{symbol.name}</span>
        <span style={{ color: '#555', fontSize: 11, marginLeft: 'auto' }}>{symbol.kind}</span>
      </button>
      {symbol.children?.map((child, i) => (
        <SymbolItem
          key={i}
          symbol={child}
          depth={depth + 1}
          onNavigate={onNavigate}
          onClose={onClose}
        />
      ))}
    </>
  )
}

export function SymbolOutline({ isOpen, onClose, symbols, onNavigate }: SymbolOutlineProps) {
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
          maxHeight: '70vh',
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
            Document Symbols
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

        {/* Symbols list */}
        <div style={{ overflow: 'auto', flex: 1 }}>
          {symbols.length === 0 ? (
            <div style={{ padding: 16, color: '#888', fontSize: 13, textAlign: 'center' }}>
              No symbols found
            </div>
          ) : (
            symbols.map((sym, i) => (
              <SymbolItem
                key={i}
                symbol={sym}
                depth={0}
                onNavigate={onNavigate}
                onClose={onClose}
              />
            ))
          )}
        </div>
      </div>
    </>
  )
}
