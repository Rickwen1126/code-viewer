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

// Health check
app.get('/health', (c) => c.json({ status: 'ok', version: '0.0.1' }))

// WS routes
app.get('/ws/extension', createExtensionHandler(upgradeWebSocket))
app.get('/ws/frontend', createFrontendHandler(upgradeWebSocket))

const port = Number(process.env.PORT) || 3000
const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Backend listening on port ${info.port}`)
})

// CRITICAL: injectWebSocket MUST be called AFTER serve()
injectWebSocket(server)

// Start heartbeat after server is up
manager.startHeartbeat()

export { app, upgradeWebSocket }
