# Quickstart：Foundation 開發環境

## 前置需求

- Docker + Docker Compose
- Node.js 22+（本地開發用）
- pnpm（monorepo package manager）

## 專案結構

```
code-viewer/
├── extension/              ← VSCode Extension
│   ├── src/
│   │   ├── extension.ts    ← activate/deactivate
│   │   ├── bridge-client.ts ← WebSocket bridge
│   │   ├── protocol.ts     ← JSON-RPC 2.0 types
│   │   ├── pending-requests.ts
│   │   └── handlers/       ← fs, workspace handlers
│   ├── package.json
│   ├── tsconfig.json
│   └── esbuild.mjs
├── backend/                ← Hono Backend
│   ├── src/
│   │   ├── index.ts        ← server bootstrap + injectWebSocket
│   │   ├── app.ts          ← Hono app + route mounting
│   │   ├── routes/
│   │   │   ├── api/        ← REST endpoints
│   │   │   └── ws/         ← WebSocket bridge endpoint
│   │   ├── middleware/
│   │   └── types/
│   ├── package.json
│   ├── tsconfig.json
│   └── Dockerfile
├── frontend/               ← React Mobile Viewer
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── services/       ← API client
│   │   └── workers/        ← Shiki Web Worker
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── packages/               ← 共享 types
│   └── protocol/           ← JSON-RPC 2.0 共享型別
├── docker-compose.yml
├── config.json             ← 專案設定（volume mount）
├── pnpm-workspace.yaml
└── CLAUDE.md
```

## 啟動開發環境

```bash
# 1. 安裝 monorepo dependencies
pnpm install

# 2. 啟動 Docker services（code-server + backend）
docker compose up -d

# 3. 啟動 frontend dev server
cd frontend && pnpm dev

# 4. 開啟手機瀏覽器或 Chrome DevTools mobile simulation
# http://localhost:5173
```

## config.json 範例

```json
{
  "projects": [
    { "id": "proj-1", "name": "my-app", "rootPath": "/workspace/my-app" },
    { "id": "proj-2", "name": "backend", "rootPath": "/workspace/backend" }
  ],
  "port": 3000
}
```

## Docker Compose 架構

```yaml
services:
  code-server:
    image: codercom/code-server:4.109.2
    # Extension 自動安裝
    volumes:
      - ./projects:/workspace:ro  # 專案目錄 mount
      - ./extension/dist:/extensions/code-viewer-bridge

  backend:
    build: ./backend
    ports:
      - "3000:3000"
    volumes:
      - ./config.json:/app/config.json:ro
      - ./projects:/workspace:ro  # fallback 直接讀取用
    environment:
      CODE_SERVER_URL: "http://code-server:8080"

  # frontend 在開發時用 vite dev server，production 時 build 成 static 由 backend 或 nginx serve
```

## 關鍵技術選擇

| 元件 | 技術 | 版本 |
|------|------|------|
| Extension runtime | code-server (VS Code 1.109.2) | 4.109.2 |
| Extension bundler | esbuild | latest |
| Extension WebSocket | ws (npm, bundled) | ^8.x |
| Backend framework | Hono + @hono/node-server | latest |
| Backend WebSocket | @hono/node-ws | latest |
| Backend runtime | Node.js Alpine | 22 |
| Frontend framework | React | 19 |
| Frontend bundler | Vite | latest |
| Syntax highlighting | Shiki (core + JS engine) | latest |
| Virtual scrolling | @tanstack/react-virtual | latest |
| WS Protocol | JSON-RPC 2.0 | — |
| Testing | Vitest + Playwright | latest |
| Package manager | pnpm | latest |
