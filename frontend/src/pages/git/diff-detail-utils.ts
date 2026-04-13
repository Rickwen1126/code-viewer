import type { DiffHunk, FilePreviewKind } from '@code-viewer/shared'

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

interface GitMediaPreviewOptions {
  previewKind: FilePreviewKind | null
  commit?: string
  status?: string
  hasDiffHunks: boolean
}

export function shouldLoadGitMediaPreview({
  previewKind,
  commit,
  status,
  hasDiffHunks,
}: GitMediaPreviewOptions): boolean {
  return previewKind != null && !commit && status !== 'deleted' && !hasDiffHunks
}

export function shouldLoadAddedFileTextFallback({
  previewKind,
  commit,
  status,
  hasDiffHunks,
}: GitMediaPreviewOptions): boolean {
  return previewKind == null && !commit && status === 'added' && !hasDiffHunks
}
