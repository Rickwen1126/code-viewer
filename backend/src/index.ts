import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { createNodeWebSocket } from '@hono/node-ws'
import type { UpgradeWebSocket } from 'hono/ws'
import { createExtensionHandler, createFrontendHandler } from './ws/handler.js'
import { manager } from './ws/manager.js'

// Create app + WS
const app = new Hono()
const wsHelper = createNodeWebSocket({ app })
const injectWebSocket = wsHelper.injectWebSocket
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const upgradeWebSocket = wsHelper.upgradeWebSocket as UpgradeWebSocket<any, any>
const backendVersion = '0.0.1'

function isAuthorized(secret: string | undefined | null): boolean {
  const expected = process.env.CODE_VIEWER_SECRET
  if (!expected) return true
  return secret === expected
}

// Health check
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

// WS routes
app.get('/ws/extension', createExtensionHandler(upgradeWebSocket))
app.get('/ws/frontend', createFrontendHandler(upgradeWebSocket))

const port = Number(process.env.PORT) || 4800
const hostname = process.env.HOST || '0.0.0.0'
const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`Backend listening on ${hostname}:${info.port}`)
})

// CRITICAL: injectWebSocket MUST be called AFTER serve()
injectWebSocket(server)

// Start heartbeat after server is up
manager.startHeartbeat()

if (process.env.CODE_VIEWER_SECRET) {
  console.log('Authentication enabled')
} else {
  console.warn('WARNING: No CODE_VIEWER_SECRET set — WS endpoints are unauthenticated')
}

// Graceful shutdown: clean up heartbeat + WS connections
function shutdown() {
  console.log('[Backend] Shutting down...')
  manager.stopHeartbeat()
  for (const [, entry] of manager.extensions) {
    try { entry.ws.close() } catch { /* ignore */ }
  }
  for (const [, entry] of manager.frontends) {
    try { entry.ws.close() } catch { /* ignore */ }
  }
  server.close()
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

export { app, upgradeWebSocket }
