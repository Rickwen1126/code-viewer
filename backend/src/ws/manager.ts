import type { WSContext } from 'hono/ws'
import type { Workspace } from '@code-viewer/shared'

interface ExtensionEntry {
  ws: WSContext
  workspace: Workspace
  connectedAt: number
  lastHeartbeat: number
  status: 'connected' | 'stale'
  staleAt: number | null
}

interface FrontendEntry {
  ws: WSContext
  selectedExtensionId: string | null
  connectedAt: number
}

class ConnectionManager {
  extensions = new Map<string, ExtensionEntry>()
  frontends = new Map<string, FrontendEntry>()
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null

  startHeartbeat(): void {
    if (this.heartbeatInterval !== null) return

    this.heartbeatInterval = setInterval(() => {
      const now = Date.now()
      const toRemove: string[] = []

      for (const [id, entry] of this.extensions) {
        const elapsed = now - entry.lastHeartbeat

        if (elapsed > 40000 && entry.status === 'connected') {
          entry.status = 'stale'
          entry.staleAt = now
          console.log(`Extension ${id} marked stale`)
        }

        if (entry.status === 'stale' && entry.staleAt !== null) {
          const staleElapsed = now - entry.staleAt
          if (staleElapsed > 5 * 60 * 1000) {
            console.log(`Extension ${id} removed after 5min stale`)
            toRemove.push(id)
          }
        }

        // Ping the underlying WS and listen for pong
        try {
          const rawWs = (entry.ws as unknown as { raw?: { ping?: (data?: unknown, mask?: boolean, cb?: (err?: Error) => void) => void; once?: (event: string, cb: () => void) => void } }).raw
          if (rawWs?.ping) {
            rawWs.ping()
            // If we can listen for pong, update heartbeat when it arrives
            rawWs.once?.('pong', () => {
              this.updateHeartbeat(id)
            })
          }
        } catch {
          // ignore ping errors
        }
      }

      for (const id of toRemove) {
        this.extensions.delete(id)
      }
    }, 30000)
  }

  stopHeartbeat(): void {
    if (this.heartbeatInterval !== null) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  addExtension(id: string, ws: WSContext, workspace: Workspace): void {
    const now = Date.now()
    this.extensions.set(id, {
      ws,
      workspace,
      connectedAt: now,
      lastHeartbeat: now,
      status: 'connected',
      staleAt: null,
    })
  }

  removeExtension(id: string): void {
    this.extensions.delete(id)
  }

  getExtension(id: string): ExtensionEntry | undefined {
    return this.extensions.get(id)
  }

  addFrontend(id: string, ws: WSContext): void {
    this.frontends.set(id, {
      ws,
      selectedExtensionId: null,
      connectedAt: Date.now(),
    })
  }

  removeFrontend(id: string): void {
    this.frontends.delete(id)
  }

  getFrontend(id: string): FrontendEntry | undefined {
    return this.frontends.get(id)
  }

  selectWorkspace(frontendId: string, extensionId: string): void {
    const frontend = this.frontends.get(frontendId)
    if (frontend) {
      frontend.selectedExtensionId = extensionId
    }
  }

  listWorkspaces(): Array<{
    extensionId: string
    displayName: string
    rootPath: string
    gitBranch: string | null
    extensionVersion: string
    status: 'connected' | 'stale'
  }> {
    const result: Array<{
      extensionId: string
      displayName: string
      rootPath: string
      gitBranch: string | null
      extensionVersion: string
      status: 'connected' | 'stale'
    }> = []

    for (const [extensionId, entry] of this.extensions) {
      result.push({
        extensionId,
        displayName: entry.workspace.name,
        rootPath: entry.workspace.rootPath,
        gitBranch: entry.workspace.gitBranch,
        extensionVersion: entry.workspace.extensionVersion ?? 'unknown',
        status: entry.status,
      })
    }

    return result
  }

  getFrontendsForExtension(extensionId: string): FrontendEntry[] {
    const result: FrontendEntry[] = []
    for (const entry of this.frontends.values()) {
      if (entry.selectedExtensionId === extensionId) {
        result.push(entry)
      }
    }
    return result
  }

  updateHeartbeat(extensionId: string): void {
    const entry = this.extensions.get(extensionId)
    if (entry) {
      entry.lastHeartbeat = Date.now()
      entry.status = 'connected'
      entry.staleAt = null
    }
  }

  getAdminWorkspaces(): Array<{
    extensionId: string
    displayName: string
    rootPath: string
    gitBranch: string | null
    vscodeVersion: string
    extensionVersion: string
    connectedAt: number
    lastHeartbeat: number
    status: 'connected' | 'stale'
  }> {
    const result: Array<{
      extensionId: string
      displayName: string
      rootPath: string
      gitBranch: string | null
      vscodeVersion: string
      extensionVersion: string
      connectedAt: number
      lastHeartbeat: number
      status: 'connected' | 'stale'
    }> = []

    for (const [extensionId, entry] of this.extensions) {
      result.push({
        extensionId,
        displayName: entry.workspace.name,
        rootPath: entry.workspace.rootPath,
        gitBranch: entry.workspace.gitBranch,
        vscodeVersion: entry.workspace.vscodeVersion,
        extensionVersion: entry.workspace.extensionVersion ?? 'unknown',
        connectedAt: entry.connectedAt,
        lastHeartbeat: entry.lastHeartbeat,
        status: entry.status,
      })
    }

    return result
  }
}

export const manager = new ConnectionManager()
export { ConnectionManager }
export type { ExtensionEntry, FrontendEntry }
