import type { DiffHunk, DiffChange } from '@code-viewer/shared'
import { useTheme } from '../hooks/use-theme'

interface DiffViewProps {
  hunks: DiffHunk[]
}

interface DiffPalette {
  addedBg: string
  addedText: string
  deletedBg: string
  deletedText: string
  normalBg: string
  normalText: string
  hunkHeaderBg: string
  hunkHeaderText: string
  deletedStrike: boolean
}

const COLORS: DiffPalette = {
  addedBg: '#1e3a1e',
  addedText: '#4ec9b0',
  deletedBg: '#3a1e1e',
  deletedText: '#f48771',
  normalBg: 'transparent',
  normalText: '#d4d4d4',
  hunkHeaderBg: '#2d2d2d',
  hunkHeaderText: '#888',
  deletedStrike: false,
}

// Print convention on grayscale e-ink: additions get a light tint, deletions a strike-through.
const EINK_COLORS: DiffPalette = {
  addedBg: '#e2e2e2',
  addedText: '#000000',
  deletedBg: 'transparent',
  deletedText: '#6e6e6e',
  normalBg: 'transparent',
  normalText: '#000000',
  hunkHeaderBg: '#ffffff',
  hunkHeaderText: '#000000',
  deletedStrike: true,
}

function DiffLine({ change, palette }: { change: DiffChange; palette: DiffPalette }) {
  let bg: string
  let color: string
  let prefix: string

  if (change.type === 'add') {
    bg = palette.addedBg
    color = palette.addedText
    prefix = '+'
  } else if (change.type === 'delete') {
    bg = palette.deletedBg
    color = palette.deletedText
    prefix = '-'
  } else {
    bg = palette.normalBg
    color = palette.normalText
    prefix = ' '
  }

  const strike = change.type === 'delete' && palette.deletedStrike

  const lineNum = change.type === 'add'
    ? change.newLineNumber
    : change.type === 'delete'
      ? change.oldLineNumber
      : change.newLineNumber

  return (
    <div
      className="cv-eink-keep"
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
          ...(strike ? { textDecoration: 'line-through', textDecorationColor: '#8a8a8a' } : undefined),
        }}
      >
        {change.content}
      </span>
    </div>
  )
}

function HunkHeader({ hunk, palette }: { hunk: DiffHunk; palette: DiffPalette }) {
  const label = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`
  return (
    <div
      className="cv-eink-keep"
      style={{
        background: palette.hunkHeaderBg,
        color: palette.hunkHeaderText,
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
  const palette = useTheme() === 'eink' ? EINK_COLORS : COLORS

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
      <div style={{ display: 'inline-block', minWidth: '100%' }}>
        {hunks.map((hunk, i) => (
          <div key={i}>
            <HunkHeader hunk={hunk} palette={palette} />
            {hunk.changes.map((change, j) => (
              <DiffLine key={j} change={change} palette={palette} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
