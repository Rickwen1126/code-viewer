import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { UpgradeWebSocket } from 'hono/ws'
import { createApp } from '../app.js'
import { manager } from '../ws/manager.js'
import type { Workspace } from '@code-viewer/shared'

function createMockWs() {
  return {
    ws: { send: (_data: string) => {} },
  }
}

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    extensionId: 'ext-1',
    name: 'Code Viewer',
    rootPath: '/Users/rickwen/code/code-viewer',
    gitBranch: 'main',
    vscodeVersion: '1.114.0',
    extensionVersion: '0.0.3',
    ...overrides,
  }
}

const noopUpgradeWebSocket = (((_handler: unknown) => {
  return () => new Response('WebSocket test stub', { status: 501 })
}) as unknown) as UpgradeWebSocket<any, any>

describe('backend http routes', () => {
  beforeEach(() => {
    manager.extensions.clear()
    manager.frontends.clear()
  })

  afterEach(() => {
    manager.stopHeartbeat()
    manager.extensions.clear()
    manager.frontends.clear()
  })

  it('returns deep links for a connected workspace', async () => {
    const app = createApp(noopUpgradeWebSocket)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    manager.addExtension('ext-1', createMockWs().ws as any, makeWorkspace())

    const response = await app.request(
      'http://localhost/api/links/file?workspace=%2FUsers%2Frickwen%2Fcode%2Fcode-viewer&path=frontend%2Fsrc%2Fapp.tsx&line=12&endLine=20',
    )

    expect(response.status).toBe(200)

    const body = await response.json() as {
      status: string
      workspace: { rootPath: string; displayName: string }
      resolverPath: string
      localUrl: string
    }

    expect(body.status).toBe('ok')
    expect(body.workspace.rootPath).toBe('/Users/rickwen/code/code-viewer')
    expect(body.workspace.displayName).toBe('Code Viewer')
    expect(body.resolverPath).toBe(
      '/open/file?workspace=%2FUsers%2Frickwen%2Fcode%2Fcode-viewer&path=frontend%2Fsrc%2Fapp.tsx&line=12&endLine=20',
    )
    expect(body.localUrl).toBe(
      'http://localhost:4801/open/file?workspace=%2FUsers%2Frickwen%2Fcode%2Fcode-viewer&path=frontend%2Fsrc%2Fapp.tsx&line=12&endLine=20',
    )
  })

  it('rejects unknown workspaces and invalid paths', async () => {
    const app = createApp(noopUpgradeWebSocket)

    const missingWorkspace = await app.request(
      'http://localhost/api/links/file?workspace=%2Fmissing&path=frontend%2Fsrc%2Fapp.tsx',
    )
    expect(missingWorkspace.status).toBe(404)

    const invalidPath = await app.request(
      'http://localhost/api/links/file?workspace=%2FUsers%2Frickwen%2Fcode%2Fcode-viewer&path=..%2Fsecret.txt',
    )
    expect(invalidPath.status).toBe(400)
  })
})
