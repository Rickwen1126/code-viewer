import { serve } from "@hono/node-server";
import { app, injectWebSocket } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();

const server = serve(
  {
    fetch: app.fetch,
    port: config.port,
  },
  (info) => {
    console.log(`Backend listening on http://localhost:${info.port}`);
  },
);

injectWebSocket(server);
