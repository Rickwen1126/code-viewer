import type { DiffHunk } from '@code-viewer/shared'

export function buildAddedFileHunks(content: string): DiffHunk[] {
  if (content === '') return []

  const lines = content.split('\n')
  return [
    {
      oldStart: 0,
      oldLines: 0,
      newStart: 1,
      newLines: lines.length,
      changes: lines.map((line, index) => ({
        type: 'add' as const,
        content: line,
        newLineNumber: index + 1,
      })),
    },
  ]
}
