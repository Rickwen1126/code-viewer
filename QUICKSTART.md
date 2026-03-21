# Quickstart

## Prerequisites

- Node.js >= 20
- pnpm 9.x (`corepack enable && corepack prepare pnpm@9.15.4 --activate`)
- VS Code >= 1.100 (with Copilot for chat features)

## Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Build all packages (shared types + backend + extension + frontend)
pnpm -r build
```

## Run (3 terminals)

```bash
# Terminal 1: Backend relay server
pnpm --filter @code-viewer/backend dev
# → "Backend listening on 0.0.0.0:3000"

# Terminal 2: Frontend dev server
pnpm --filter @code-viewer/frontend dev
# → "http://localhost:4801"

# Terminal 3: Extension (VS Code)
# Open VS Code in the project root, then:
# 1. Press F5 to launch Extension Development Host
# 2. The extension auto-connects to ws://localhost:4800
# 3. Or run command: "Code Viewer: Connect to Backend"
```

## Access

Open `http://localhost:4801` on your phone (same network) or browser.

For remote access via Tailscale, set `VITE_WS_URL` in frontend and `codeViewer.backendUrl` in VS Code settings to point to the Tailscale IP.

## Auth (optional)

```bash
# Set shared secret for WS authentication
export CODE_VIEWER_SECRET=your-secret-here
# Then start backend — frontend/extension must pass ?secret=... in WS URL
```

## Verify

1. Backend starts without errors and logs "Backend listening on 0.0.0.0:3000"
2. Frontend opens at http://localhost:4801 and shows workspace picker
3. Extension connects and workspace appears in frontend list
4. Select workspace → file tree loads
5. Tap a file → syntax-highlighted code with line numbers
