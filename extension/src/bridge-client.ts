import WebSocket from "ws";
import * as vscode from "vscode";
import type { BridgeRequest, BridgeResponse } from "@code-viewer/protocol";

type MethodHandler = (params: unknown) => Promise<unknown>;

const RECONNECT_BASE_MS = 1000;
const RECONNECT_FACTOR = 2;
const RECONNECT_MAX_MS = 60_000;
const RECONNECT_JITTER = 0.2;
const HEARTBEAT_INTERVAL_MS = 25_000;
const HEARTBEAT_TIMEOUT_MS = 10_000;

export class BridgeClient implements vscode.Disposable {
  private ws: WebSocket | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private handlers = new Map<string, MethodHandler>();
  private outputChannel: vscode.OutputChannel;

  constructor(private readonly url: string) {
    this.outputChannel = vscode.window.createOutputChannel(
      "Code Viewer Bridge",
    );
  }

  connect(): void {
    if (this.disposed) return;

    this.log(`Connecting to ${this.url}...`);

    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      this.log(`Connection error: ${err}`);
      this.scheduleReconnect();
      return;
    }

    this.ws.on("open", () => {
      this.log("Connected");
      this.reconnectAttempt = 0;
      this.startHeartbeat();
    });

    this.ws.on("message", (data) => {
      this.onMessage(String(data));
    });

    this.ws.on("pong", () => {
      this.clearPongTimer();
    });

    this.ws.on("close", (code, reason) => {
      this.log(`Disconnected: ${code} ${String(reason)}`);
      this.cleanup();
      this.scheduleReconnect();
    });

    this.ws.on("error", (err) => {
      this.log(`WebSocket error: ${err.message}`);
      // 'close' event will fire after 'error', triggering reconnect
    });
  }

  registerHandler(method: string, handler: MethodHandler): void {
    this.handlers.set(method, handler);
  }

  dispose(): void {
    this.disposed = true;
    this.cleanup();

    if (this.ws) {
      // Graceful shutdown: send close frame with 1000 Normal Closure
      this.ws.close(1000, "Extension deactivating");
      this.ws = null;
    }

    this.outputChannel.dispose();
  }

  private async onMessage(raw: string): Promise<void> {
    let request: BridgeRequest;
    try {
      request = JSON.parse(raw);
    } catch {
      this.log(`Invalid JSON received: ${raw.slice(0, 100)}`);
      return;
    }

    if (request.jsonrpc !== "2.0" || !request.id || !request.method) {
      this.log(`Invalid JSON-RPC message: ${raw.slice(0, 100)}`);
      return;
    }

    const handler = this.handlers.get(request.method);
    if (!handler) {
      this.sendResponse({
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: -32601,
          message: `Method not found: ${request.method}`,
        },
      });
      return;
    }

    try {
      const result = await handler(request.params);
      this.sendResponse({ jsonrpc: "2.0", id: request.id, result });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code =
        err instanceof Error && "code" in err
          ? (err as Error & { code: number }).code
          : -32603;
      this.sendResponse({
        jsonrpc: "2.0",
        id: request.id,
        error: { code, message },
      });
    }
  }

  private sendResponse(response: BridgeResponse): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(response));
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;

    const base = Math.min(
      RECONNECT_BASE_MS * Math.pow(RECONNECT_FACTOR, this.reconnectAttempt),
      RECONNECT_MAX_MS,
    );
    const jitter = 1 + (Math.random() * 2 - 1) * RECONNECT_JITTER;
    const delay = Math.round(base * jitter);

    this.log(
      `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt + 1})`,
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempt++;
      this.connect();
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.ping();
        this.pongTimer = setTimeout(() => {
          this.log("Pong timeout — closing connection");
          this.ws?.terminate();
        }, HEARTBEAT_TIMEOUT_MS);
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.clearPongTimer();
  }

  private clearPongTimer(): void {
    if (this.pongTimer) {
      clearTimeout(this.pongTimer);
      this.pongTimer = null;
    }
  }

  private cleanup(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private log(message: string): void {
    const ts = new Date().toISOString();
    this.outputChannel.appendLine(`[${ts}] ${message}`);
  }
}
