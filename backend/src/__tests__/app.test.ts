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
    workspaceKey: 'ws_placeholder',
    name: 'Code Viewer',
    rootPath: '/Users/rickwen/code/code-viewer',
    gitBranch: 'main',
    vscodeVersion: '1.114.0',
    extensionVersion: '0.0.5',
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
    const workspaceKey = manager.getOrCreateWorkspaceKey('/Users/rickwen/code/code-viewer')

    const response = await app.request(
      `http://localhost/api/links/file?workspace=${encodeURIComponent(workspaceKey)}&path=frontend%2Fsrc%2Fapp.tsx&line=12&endLine=20`,
    )

    expect(response.status).toBe(200)

    const body = await response.json() as {
      status: string
      workspace: { workspaceKey: string; displayName: string }
      resolverPath: string
      localUrl: string
    }

    expect(body.status).toBe('ok')
    expect(body.workspace.workspaceKey).toBe(workspaceKey)
    expect(body.workspace.displayName).toBe('Code Viewer')
    expect(body.resolverPath).toBe(
      `/open/file?workspace=${workspaceKey}&path=frontend%2Fsrc%2Fapp.tsx&line=12&endLine=20`,
    )
    expect(body.localUrl).toBe(
      `http://localhost:4801/open/file?workspace=${workspaceKey}&path=frontend%2Fsrc%2Fapp.tsx&line=12&endLine=20`,
    )
  })

  it('returns git diff and tour-step links for a connected workspace', async () => {
    const app = createApp(noopUpgradeWebSocket)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    manager.addExtension('ext-1', createMockWs().ws as any, makeWorkspace())
    const workspaceKey = manager.getOrCreateWorkspaceKey('/Users/rickwen/code/code-viewer')

    const diffResponse = await app.request(
      `http://localhost/api/links/diff?workspace=${encodeURIComponent(workspaceKey)}&path=packages%2Fcli%2Fsrc%2Findex.ts&commit=abc123&status=modified`,
    )
    expect(diffResponse.status).toBe(200)
    const diffBody = await diffResponse.json() as { status: string; resolverPath: string; localUrl: string }
    expect(diffBody.status).toBe('ok')
    expect(diffBody.resolverPath).toBe(
      `/open/git-diff?workspace=${workspaceKey}&path=packages%2Fcli%2Fsrc%2Findex.ts&commit=abc123&status=modified`,
    )
    expect(diffBody.localUrl).toBe(
      `http://localhost:4801/open/git-diff?workspace=${workspaceKey}&path=packages%2Fcli%2Fsrc%2Findex.ts&commit=abc123&status=modified`,
    )

    const tourResponse = await app.request(
      `http://localhost/api/links/tour-step?workspace=${encodeURIComponent(workspaceKey)}&tourId=review-tour&step=3`,
    )
    expect(tourResponse.status).toBe(200)
    const tourBody = await tourResponse.json() as { status: string; resolverPath: string; localUrl: string }
    expect(tourBody.status).toBe('ok')
    expect(tourBody.resolverPath).toBe(
      `/open/tour?workspace=${workspaceKey}&tourId=review-tour&step=3`,
    )
    expect(tourBody.localUrl).toBe(
      `http://localhost:4801/open/tour?workspace=${workspaceKey}&tourId=review-tour&step=3`,
    )
  })

  it('rejects unknown workspaces and invalid paths', async () => {
    const app = createApp(noopUpgradeWebSocket)

    const missingWorkspace = await app.request(
      'http://localhost/api/links/file?workspace=%2Fmissing&path=frontend%2Fsrc%2Fapp.tsx',
    )
    expect(missingWorkspace.status).toBe(404)

    const workspaceKey = manager.getOrCreateWorkspaceKey('/Users/rickwen/code/code-viewer')
    const invalidPath = await app.request(
      `http://localhost/api/links/file?workspace=${encodeURIComponent(workspaceKey)}&path=..%2Fsecret.txt`,
    )
    expect(invalidPath.status).toBe(400)

    const invalidTour = await app.request(
      `http://localhost/api/links/tour-step?workspace=${encodeURIComponent(workspaceKey)}`,
    )
    expect(invalidTour.status).toBe(400)

    const invalidDiff = await app.request(
      `http://localhost/api/links/diff?workspace=${encodeURIComponent(workspaceKey)}`,
    )
    expect(invalidDiff.status).toBe(400)
  })
})
