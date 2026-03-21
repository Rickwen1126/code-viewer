import type { DiffHunk, DiffChange } from '@code-viewer/shared'

interface DiffViewProps {
  hunks: DiffHunk[]
}

const COLORS = {
  addedBg: '#1e3a1e',
  addedText: '#4ec9b0',
  deletedBg: '#3a1e1e',
  deletedText: '#f48771',
  normalBg: 'transparent',
  normalText: '#d4d4d4',
  hunkHeaderBg: '#2d2d2d',
  hunkHeaderText: '#888',
}

function DiffLine({ change }: { change: DiffChange }) {
  let bg: string
  let color: string
  let prefix: string

  if (change.type === 'add') {
    bg = COLORS.addedBg
    color = COLORS.addedText
    prefix = '+'
  } else if (change.type === 'delete') {
    bg = COLORS.deletedBg
    color = COLORS.deletedText
    prefix = '-'
  } else {
    bg = COLORS.normalBg
    color = COLORS.normalText
    prefix = ' '
  }

  const lineNum = change.type === 'add'
    ? change.newLineNumber
    : change.type === 'delete'
      ? change.oldLineNumber
      : change.newLineNumber

  return (
    <div
      style={{
        display: 'flex',
        background: bg,
        minHeight: 20,
      }}
    >
      <span
        style={{
          flexShrink: 0,
          width: 40,
          textAlign: 'right',
          paddingRight: 8,
          color: '#555',
          fontSize: 11,
          lineHeight: '20px',
          userSelect: 'none',
        }}
      >
        {lineNum ?? ''}
      </span>
      <span
        style={{
          flexShrink: 0,
          width: 16,
          textAlign: 'center',
          color: color,
          fontSize: 12,
          lineHeight: '20px',
          userSelect: 'none',
        }}
      >
        {prefix}
      </span>
      <span
        style={{
          flex: 1,
          color: color,
          fontSize: 12,
          fontFamily: "'JetBrains Mono', monospace",
          lineHeight: '20px',
          whiteSpace: 'pre',
          overflowX: 'auto',
        }}
      >
        {change.content}
      </span>
    </div>
  )
}

function HunkHeader({ hunk }: { hunk: DiffHunk }) {
  const label = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`
  return (
    <div
      style={{
        background: COLORS.hunkHeaderBg,
        color: COLORS.hunkHeaderText,
        fontSize: 11,
        fontFamily: "'JetBrains Mono', monospace",
        padding: '2px 8px',
        lineHeight: '20px',
      }}
    >
      {label}
    </div>
  )
}

export function DiffView({ hunks }: DiffViewProps) {
  if (hunks.length === 0) {
    return (
      <div style={{ padding: 16, color: '#888', fontSize: 13 }}>
        No changes to show.
      </div>
    )
  }

  return (
    <div
      style={{
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: 12,
        overflowX: 'auto',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {hunks.map((hunk, i) => (
        <div key={i}>
          <HunkHeader hunk={hunk} />
          {hunk.changes.map((change, j) => (
            <DiffLine key={j} change={change} />
          ))}
        </div>
      ))}
    </div>
  )
}
