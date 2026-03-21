import type { FileTreeNode } from '@code-viewer/shared'

interface CacheEntry<T> {
  data: T
  updatedAt: number
}

class SessionCache {
  private fileTreeCache = new Map<string, CacheEntry<FileTreeNode[]>>()
  private TTL = 5 * 60 * 1000 // 5 minutes

  getFileTree(extensionId: string): FileTreeNode[] | null {
    const entry = this.fileTreeCache.get(extensionId)
    if (!entry) return null

    const age = Date.now() - entry.updatedAt
    if (age > this.TTL) {
      this.fileTreeCache.delete(extensionId)
      return null
    }

    return entry.data
  }

  setFileTree(extensionId: string, nodes: FileTreeNode[]): void {
    this.fileTreeCache.set(extensionId, {
      data: nodes,
      updatedAt: Date.now(),
    })
  }

  invalidateExtension(extensionId: string): void {
    this.fileTreeCache.delete(extensionId)
  }
}

export const cache = new SessionCache()
export { SessionCache }
