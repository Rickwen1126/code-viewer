import type { WatchDescriptor } from '@code-viewer/shared'
import { decodeFileRoutePath } from './file-location'

export function getRouteWatches(pathname: string): WatchDescriptor[] {
  const filePath = decodeFileRoutePath(pathname)
  if (filePath) {
    return [{ topic: 'file.content', path: filePath }]
  }

  if (pathname === '/git' || pathname.startsWith('/git/')) {
    return [{ topic: 'git.status', scope: 'workspace' }]
  }

  return []
}
