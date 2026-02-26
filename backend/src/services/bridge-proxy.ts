import { randomUUID } from "node:crypto";
import type { WSContext } from "hono/ws";
import type {
  BridgeRequest,
  BridgeResponse,
  BridgeStatus,
  MethodMap,
  MethodName,
} from "@code-viewer/protocol";

const REQUEST_TIMEOUT_MS = 30_000;

interface PendingEntry {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

class BridgeProxy {
  private ws: WSContext | null = null;
  private pending = new Map<string, PendingEntry>();
  private _status: BridgeStatus = "disconnected";

  get status(): BridgeStatus {
    return this._status;
  }

  isConnected(): boolean {
    return this.ws !== null && this._status === "connected";
  }

  setConnection(ws: WSContext): void {
    // New connection replaces old (Extension restart scenario)
    if (this.ws) {
      console.log("Replacing existing bridge connection");
      this.ws.close(1000, "Replaced by new connection");
    }
    this.ws = ws;
    this._status = "connected";
    console.log("Bridge connection established");
  }

  removeConnection(ws: WSContext): void {
    if (this.ws === ws) {
      this.ws = null;
      this._status = "disconnected";
      this.rejectAllPending("Bridge connection lost");
      console.log("Bridge connection closed");
    }
  }

  handleResponse(raw: string): void {
    let response: BridgeResponse;
    try {
      response = JSON.parse(raw);
    } catch {
      console.error("Invalid JSON from Extension:", raw.slice(0, 100));
      return;
    }

    if (response.jsonrpc !== "2.0" || !response.id) return;

    const entry = this.pending.get(response.id);
    if (!entry) return;

    this.pending.delete(response.id);
    clearTimeout(entry.timer);

    if (response.error) {
      entry.reject(
        new Error(`${response.error.message} (code: ${response.error.code})`),
      );
    } else {
      entry.resolve(response.result);
    }
  }

  sendRequest<M extends MethodName>(
    method: M,
    params: MethodMap[M]["params"],
  ): Promise<MethodMap[M]["result"]> {
    if (!this.ws) {
      return Promise.reject(new Error("Bridge not connected"));
    }

    const id = randomUUID();
    const request: BridgeRequest = { jsonrpc: "2.0", id, method, params };

    return new Promise<MethodMap[M]["result"]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Bridge request ${method} timed out`));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      this.ws!.send(JSON.stringify(request));
    });
  }

  private rejectAllPending(reason: string): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
    this.pending.clear();
  }
}

export const bridgeProxy = new BridgeProxy();
