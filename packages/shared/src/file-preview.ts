export type FilePreviewKind = 'image' | 'video'

const IMAGE_MIME_TYPES = new Map<string, string>([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.avif', 'image/avif'],
])

const VIDEO_MIME_TYPES = new Map<string, string>([
  ['.mp4', 'video/mp4'],
  ['.webm', 'video/webm'],
  ['.mov', 'video/quicktime'],
  ['.m4v', 'video/x-m4v'],
  ['.ogv', 'video/ogg'],
])

function getExtension(path: string): string {
  const fileName = path.split('/').pop() ?? path
  const lastDot = fileName.lastIndexOf('.')
  return lastDot >= 0 ? fileName.slice(lastDot).toLowerCase() : ''
}

export function getFilePreviewKind(path: string): FilePreviewKind | null {
  const extension = getExtension(path)
  if (IMAGE_MIME_TYPES.has(extension)) return 'image'
  if (VIDEO_MIME_TYPES.has(extension)) return 'video'
  return null
}

export function getFilePreviewMimeType(path: string): string | null {
  const extension = getExtension(path)
  return IMAGE_MIME_TYPES.get(extension) ?? VIDEO_MIME_TYPES.get(extension) ?? null
}
