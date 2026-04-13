import { Hono } from 'hono'
import type { UpgradeWebSocket } from 'hono/ws'
import { createExtensionHandler, createFrontendHandler } from './ws/handler.js'
import { manager } from './ws/manager.js'
import {
  buildFileLinkResponse,
  buildGitDiffLinkResponse,
  buildTourStepLinkResponse,
  getLanIp,
  normalizeNonEmptyString,
  parseGitDiffStatus,
  normalizeRepoRelativePath,
  parsePositiveInt,
} from './http/file-links.js'

export const backendVersion = '0.0.1'

export function isAuthorized(secret: string | undefined | null): boolean {
  const expected = process.env.CODE_VIEWER_SECRET
  if (!expected) return true
  return secret === expected
}

export function registerRoutes(app: Hono, upgradeWebSocket: UpgradeWebSocket<any, any>) {
  app.get('/health', (c) => c.json({ status: 'ok', version: backendVersion }))

  app.get('/admin/workspaces', (c) => {
    if (!isAuthorized(c.req.query('secret'))) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    return c.json({
      status: 'ok',
      backendVersion,
      generatedAt: Date.now(),
      workspaces: manager.getAdminWorkspaces(),
    })
  })

  app.get('/api/links/file', (c) => {
    if (!isAuthorized(c.req.query('secret'))) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const workspaceRef = c.req.query('workspace')
    const path = normalizeRepoRelativePath(c.req.query('path'))
    if (!workspaceRef || !path) {
      return c.json({ error: 'workspace and relative path are required' }, 400)
    }

    const result = buildFileLinkResponse(
      {
        workspaceRef,
        path,
        line: parsePositiveInt(c.req.query('line')),
        endLine: parsePositiveInt(c.req.query('endLine')),
      },
      manager.listWorkspaces(),
      { lanIp: getLanIp() },
    )

    if (result.kind === 'workspace_not_found') {
      return c.json({ error: 'Workspace is not connected', workspaceRef }, 404)
    }

    if (result.kind === 'workspace_not_connected') {
      return c.json({
        error: 'Workspace is not ready for links',
        workspaceRef,
        status: result.workspace.status,
      }, 409)
    }

    return c.json({
      status: 'ok',
      generatedAt: Date.now(),
      ...result.payload,
    })
  })

  app.get('/api/links/diff', (c) => {
    if (!isAuthorized(c.req.query('secret'))) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const workspaceRef = c.req.query('workspace')
    const path = normalizeRepoRelativePath(c.req.query('path'))
    if (!workspaceRef || !path) {
      return c.json({ error: 'workspace and relative path are required' }, 400)
    }

    const result = buildGitDiffLinkResponse(
      {
        workspaceRef,
        path,
        commit: normalizeNonEmptyString(c.req.query('commit')) ?? undefined,
        status: parseGitDiffStatus(c.req.query('status')),
      },
      manager.listWorkspaces(),
      { lanIp: getLanIp() },
    )

    if (result.kind === 'workspace_not_found') {
      return c.json({ error: 'Workspace is not connected', workspaceRef }, 404)
    }

    if (result.kind === 'workspace_not_connected') {
      return c.json({
        error: 'Workspace is not ready for links',
        workspaceRef,
        status: result.workspace.status,
      }, 409)
    }

    return c.json({
      status: 'ok',
      generatedAt: Date.now(),
      ...result.payload,
    })
  })

  app.get('/api/links/tour-step', (c) => {
    if (!isAuthorized(c.req.query('secret'))) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    const workspaceRef = c.req.query('workspace')
    const tourId = normalizeNonEmptyString(c.req.query('tourId'))
    if (!workspaceRef || !tourId) {
      return c.json({ error: 'workspace and tourId are required' }, 400)
    }

    const result = buildTourStepLinkResponse(
      {
        workspaceRef,
        tourId,
        step: parsePositiveInt(c.req.query('step')),
      },
      manager.listWorkspaces(),
      { lanIp: getLanIp() },
    )

    if (result.kind === 'workspace_not_found') {
      return c.json({ error: 'Workspace is not connected', workspaceRef }, 404)
    }

    if (result.kind === 'workspace_not_connected') {
      return c.json({
        error: 'Workspace is not ready for links',
        workspaceRef,
        status: result.workspace.status,
      }, 409)
    }

    return c.json({
      status: 'ok',
      generatedAt: Date.now(),
      ...result.payload,
    })
  })

  app.get('/ws/extension', createExtensionHandler(upgradeWebSocket))
  app.get('/ws/frontend', createFrontendHandler(upgradeWebSocket))

  return app
}

export function createApp(upgradeWebSocket: UpgradeWebSocket<any, any>) {
  const app = new Hono()
  return registerRoutes(app, upgradeWebSocket)
}
