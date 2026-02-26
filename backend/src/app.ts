import { Hono } from "hono";
import { cors } from "hono/cors";
import { createNodeWebSocket } from "@hono/node-ws";
import type { BridgeError } from "@code-viewer/protocol";
import apiRouter from "./routes/api/index.js";
import { createBridgeHandler } from "./routes/ws/bridge.js";

export const app = new Hono();

const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
export { injectWebSocket };

// CORS only on REST API routes (MUST NOT apply to WebSocket routes)
const api = new Hono();
api.use("*", cors());
api.route("/", apiRouter);

app.route("/api", api);

// WebSocket bridge — single active connection slot
app.get("/ws/vscode-bridge", upgradeWebSocket(createBridgeHandler));

// Unified error handler — JSON-RPC error format
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  const error: BridgeError = {
    code: -32603,
    message: err.message,
  };
  return c.json({ error }, 500);
});
