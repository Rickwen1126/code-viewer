import type { WSEvents } from "hono/ws";
import { bridgeProxy } from "../../services/bridge-proxy.js";

export function createBridgeHandler(): WSEvents {
  return {
    onOpen(_event, ws) {
      bridgeProxy.setConnection(ws);
    },

    onMessage(event, _ws) {
      const data =
        typeof event.data === "string" ? event.data : String(event.data);
      bridgeProxy.handleResponse(data);
    },

    onClose(_event, ws) {
      bridgeProxy.removeConnection(ws);
    },

    onError(event, ws) {
      console.error("Bridge WebSocket error:", event);
      bridgeProxy.removeConnection(ws);
    },
  };
}
