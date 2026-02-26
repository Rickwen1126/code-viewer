import * as vscode from "vscode";
import { BridgeClient } from "./bridge-client";

const DEFAULT_BRIDGE_URL = "ws://backend:3000/ws/vscode-bridge";

export function activate(context: vscode.ExtensionContext) {
  const bridgeUrl =
    process.env.BRIDGE_URL ??
    vscode.workspace
      .getConfiguration("codeViewer")
      .get<string>("bridgeUrl", DEFAULT_BRIDGE_URL);

  const client = new BridgeClient(bridgeUrl);

  // Handler registration — method handlers added in Phase 3+ (T020, T025, T031)
  // e.g. client.registerHandler("fs/readDirectory", handleReadDirectory);

  client.connect();

  // Push to context.subscriptions for automatic cleanup (Disposable pattern)
  context.subscriptions.push(client);
}

export function deactivate() {
  // Disposable cleanup happens automatically via context.subscriptions
  // This function handles any additional graceful shutdown if needed
}
