import { openDB, type IDBPDatabase } from 'idb'
import type { FileTreeNode, FileContent, ChatSession, ChatTurn, GitStatus } from '@code-viewer/shared'

const TTL_24H = 24 * 60 * 60 * 1000

interface CacheDB {
  'file-tree': {
    key: string
    value: { extensionId: string; nodes: FileTreeNode[]; updatedAt: number }
  }
  'file-content': {
    key: string
    value: { content: FileContent; updatedAt: number }
  }
  'chat-sessions': {
    key: string
    value: { session: ChatSession; turns: ChatTurn[]; updatedAt: number }
  }
  'git-status': {
    key: string
    value: { status: GitStatus; updatedAt: number }
  }
}

let dbPromise: Promise<IDBPDatabase<CacheDB>> | null = null

function getDB(): Promise<IDBPDatabase<CacheDB>> {
  if (!dbPromise) {
    dbPromise = openDB<CacheDB>('code-viewer', 1, {
      upgrade(db) {
        db.createObjectStore('file-tree')
        db.createObjectStore('file-content')
        db.createObjectStore('chat-sessions')
        db.createObjectStore('git-status')
      },
    })
  }
  return dbPromise
}

export const cacheService = {
  async getFileTree(extensionId: string): Promise<FileTreeNode[] | null> {
    const db = await getDB()
    const entry = await db.get('file-tree', extensionId)
    if (!entry) return null
    return entry.nodes
  },

  async setFileTree(extensionId: string, nodes: FileTreeNode[]): Promise<void> {
    const db = await getDB()
    await db.put('file-tree', { extensionId, nodes, updatedAt: Date.now() }, extensionId)
  },

  async getFileContent(
    extensionId: string,
    path: string,
  ): Promise<FileContent | null> {
    const db = await getDB()
    const key = `${extensionId}:${path}`
    const entry = await db.get('file-content', key)
    if (!entry) return null
    if (Date.now() - entry.updatedAt > TTL_24H) return null
    return entry.content
  },

  async setFileContent(
    extensionId: string,
    path: string,
    content: FileContent,
  ): Promise<void> {
    const db = await getDB()
    const key = `${extensionId}:${path}`
    await db.put('file-content', { content, updatedAt: Date.now() }, key)
  },

  async getChatSession(
    sessionId: string,
  ): Promise<{ session: ChatSession; turns: ChatTurn[] } | null> {
    const db = await getDB()
    const entry = await db.get('chat-sessions', sessionId)
    if (!entry) return null
    return { session: entry.session, turns: entry.turns }
  },

  async setChatSession(
    session: ChatSession,
    turns: ChatTurn[],
  ): Promise<void> {
    const db = await getDB()
    await db.put(
      'chat-sessions',
      { session, turns, updatedAt: Date.now() },
      session.id,
    )
  },

  async getGitStatus(extensionId: string): Promise<GitStatus | null> {
    const db = await getDB()
    const entry = await db.get('git-status', extensionId)
    if (!entry) return null
    return entry.status
  },

  async setGitStatus(extensionId: string, status: GitStatus): Promise<void> {
    const db = await getDB()
    await db.put('git-status', { status, updatedAt: Date.now() }, extensionId)
  },
}
