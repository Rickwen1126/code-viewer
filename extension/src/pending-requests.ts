import { randomUUID } from "node:crypto";
import type { BridgeRequest, BridgeResponse, MethodMap, MethodName } from "@code-viewer/protocol";

const DEFAULT_TIMEOUT_MS = 30_000;

interface PendingEntry {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class PendingRequests {
  private map = new Map<string, PendingEntry>();

  sendRequest<M extends MethodName>(
    method: M,
    params: MethodMap[M]["params"],
    send: (data: string) => void,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<MethodMap[M]["result"]> {
    const id = randomUUID();
    const request: BridgeRequest = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    return new Promise<MethodMap[M]["result"]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.map.delete(id);
        reject(new Error(`Request ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.map.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      send(JSON.stringify(request));
    });
  }

  handleResponse(response: BridgeResponse): boolean {
    const entry = this.map.get(response.id);
    if (!entry) return false;

    this.map.delete(response.id);
    clearTimeout(entry.timer);

    if (response.error) {
      entry.reject(
        new Error(`${response.error.message} (code: ${response.error.code})`),
      );
    } else {
      entry.resolve(response.result);
    }
    return true;
  }

  rejectAll(reason: string): void {
    for (const [id, entry] of this.map) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
