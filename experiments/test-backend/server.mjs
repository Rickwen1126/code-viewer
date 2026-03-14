import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 9900;
const wss = new WebSocketServer({ port: Number(PORT) });

console.log(`[test-backend] WebSocket server listening on ws://0.0.0.0:${PORT}`);

// Track connected extensions
const extensions = new Map();
// Store experiment results
const experimentResults = new Map();

wss.on('connection', (ws, req) => {
  const clientAddr = req.socket.remoteAddress;
  const clientId = `ext-${Date.now()}`;
  console.log(`[test-backend] Client connected from ${clientAddr} (${clientId})`);
  extensions.set(clientId, ws);

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      console.log(`[test-backend] Non-JSON message: ${data.toString().slice(0, 200)}`);
      return;
    }

    console.log(`[test-backend] Received [${msg.type || 'unknown'}]: ${JSON.stringify(msg).slice(0, 200)}`);

    switch (msg.type) {
      case 'ping': {
        // Echo back with server timestamp (original behavior)
        const response = {
          ...msg,
          type: 'pong',
          serverTs: Date.now(),
          echo: true,
        };
        ws.send(JSON.stringify(response));
        console.log(`[test-backend] Sent pong`);
        break;
      }

      case 'command': {
        // Extension sent a command request - echo it back as acknowledgment
        // In production, Backend would process and route commands
        const response = {
          type: 'commandAck',
          requestId: msg.requestId,
          command: msg.command,
          experimentId: msg.experimentId,
          serverTs: Date.now(),
          status: 'received',
        };
        ws.send(JSON.stringify(response));
        console.log(`[test-backend] Acknowledged command: ${msg.command} (${msg.experimentId})`);
        break;
      }

      case 'experimentResult': {
        // Extension reporting experiment results
        experimentResults.set(msg.experimentId, {
          ...msg,
          receivedAt: Date.now(),
        });
        console.log(`[test-backend] Stored result for ${msg.experimentId}: ${msg.status}`);

        const ack = {
          type: 'resultAck',
          experimentId: msg.experimentId,
          serverTs: Date.now(),
        };
        ws.send(JSON.stringify(ack));
        break;
      }

      case 'chatHistory': {
        // Extension forwarding Copilot chat history (C1: Desktop → Mobile)
        console.log(`[test-backend] ═══ CHAT HISTORY RECEIVED (Desktop → Mobile) ═══`);
        console.log(`[test-backend] Sessions: ${msg.sessionCount || 'unknown'}`);
        if (msg.sessions) {
          for (const session of msg.sessions.slice(0, 3)) {
            console.log(`[test-backend]   - ${session.title} (${session.sessionId})`);
          }
        }

        ws.send(JSON.stringify({
          type: 'chatHistoryAck',
          serverTs: Date.now(),
          received: true,
        }));
        break;
      }

      case 'mobileQuestion': {
        // Backend sending a question from "mobile" to Extension (C2: Mobile → Desktop)
        // Forward to all connected extensions
        const payload = {
          type: 'askCopilot',
          question: msg.question,
          previousRequests: msg.previousRequests || [],
          requestId: msg.requestId || `mq-${Date.now()}`,
        };
        for (const [id, extWs] of extensions) {
          if (extWs !== ws && extWs.readyState === 1) {
            extWs.send(JSON.stringify(payload));
            console.log(`[test-backend] Forwarded question to ${id}`);
          }
        }
        break;
      }

      case 'copilotResponse': {
        // Extension returning Copilot's response (C2 return path)
        console.log(`[test-backend] ═══ COPILOT RESPONSE RECEIVED ═══`);
        console.log(`[test-backend] Request: ${msg.requestId}`);
        console.log(`[test-backend] Response preview: ${(msg.response || '').slice(0, 200)}`);
        break;
      }

      default: {
        // Unknown type - echo back (backward compatible)
        const response = {
          ...msg,
          type: 'pong',
          serverTs: Date.now(),
          echo: true,
        };
        ws.send(JSON.stringify(response));
        console.log(`[test-backend] Echoed unknown type: ${msg.type}`);
      }
    }
  });

  ws.on('close', () => {
    extensions.delete(clientId);
    console.log(`[test-backend] Client disconnected: ${clientAddr} (${clientId})`);
  });

  ws.on('error', (err) => {
    console.error(`[test-backend] Error: ${err.message}`);
  });

  // Send welcome message
  ws.send(JSON.stringify({
    type: 'welcome',
    clientId,
    serverTs: Date.now(),
    capabilities: ['command', 'experimentResult', 'chatHistory', 'mobileQuestion', 'copilotResponse'],
  }));
});

wss.on('error', (err) => {
  console.error(`[test-backend] Server error: ${err.message}`);
});

// Periodic status
setInterval(() => {
  if (extensions.size > 0) {
    console.log(`[test-backend] Active connections: ${extensions.size}, Stored results: ${experimentResults.size}`);
  }
}, 30000);
