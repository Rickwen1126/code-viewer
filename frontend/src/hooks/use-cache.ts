import { useState, useEffect, useCallback } from 'react'
import { cacheService } from '../services/cache'
import type { FileTreeNode, FileContent } from '@code-viewer/shared'

export function useFileTreeCache(extensionId: string | null): {
  data: FileTreeNode[] | null
  isLoading: boolean
  update: (nodes: FileTreeNode[]) => Promise<void>
} {
  const [data, setData] = useState<FileTreeNode[] | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!extensionId) {
      setData(null)
      return
    }

    let cancelled = false
    setIsLoading(true)

    cacheService
      .getFileTree(extensionId)
      .then((nodes) => {
        if (!cancelled) {
          setData(nodes)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setData(null)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [extensionId])

  const update = useCallback(
    async (nodes: FileTreeNode[]) => {
      if (!extensionId) return
      await cacheService.setFileTree(extensionId, nodes)
      setData(nodes)
    },
    [extensionId],
  )

  return { data, isLoading, update }
}

export function useFileContentCache(
  extensionId: string | null,
  path: string | null,
): {
  data: FileContent | null
  isLoading: boolean
  update: (content: FileContent) => Promise<void>
} {
  const [data, setData] = useState<FileContent | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!extensionId || !path) {
      setData(null)
      return
    }

    let cancelled = false
    setIsLoading(true)

    cacheService
      .getFileContent(extensionId, path)
      .then((content) => {
        if (!cancelled) {
          setData(content)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setData(null)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [extensionId, path])

  const update = useCallback(
    async (content: FileContent) => {
      if (!extensionId || !path) return
      await cacheService.setFileContent(extensionId, path, content)
      setData(content)
    },
    [extensionId, path],
  )

  return { data, isLoading, update }
}
