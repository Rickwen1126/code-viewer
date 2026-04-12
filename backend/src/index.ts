import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { createNodeWebSocket } from '@hono/node-ws'
import type { UpgradeWebSocket } from 'hono/ws'
import { backendVersion, registerRoutes } from './app.js'
import { manager } from './ws/manager.js'

const app = new Hono()
const wsHelper = createNodeWebSocket({ app })
const injectWebSocket = wsHelper.injectWebSocket
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const upgradeWebSocket = wsHelper.upgradeWebSocket as UpgradeWebSocket<any, any>
registerRoutes(app, upgradeWebSocket)

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
