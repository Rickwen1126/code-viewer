# Implementation Plan: Foundation — 檔案瀏覽與語法高亮

**Branch**: `001-foundation` | **Date**: 2026-02-25 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-foundation/spec.md`

## 摘要

建立 Code Viewer 的基礎架構：三層 monorepo（Extension + Backend + Frontend），實現手機上瀏覽專案檔案樹與語法高亮閱讀程式碼的核心功能。Extension 透過 JSON-RPC 2.0 over WebSocket 連向 Backend，Backend 以 REST API 服務 Frontend。code-server 離線時 Backend 直接讀取檔案系統作為 fallback。

## 技術背景

**語言/版本**: TypeScript 5.x（全部元件）
**主要依賴**:
- Extension: `ws` ^8.x（WebSocket client，esbuild bundle）
- Backend: Hono + `@hono/node-server` + `@hono/node-ws`
- Frontend: React 19 + Vite + Shiki (core + JS engine) + `@tanstack/react-virtual`

**儲存**: 無持久化資料庫。專案設定來自 `config.json`（Docker volume mount）
**測試**: Vitest（unit/integration）+ Playwright（E2E mobile testing）
**目標平台**: Docker container（Linux），前端為行動瀏覽器（Safari iOS / Chrome Android）
**專案類型**: Web（三元件 monorepo：extension + backend + frontend + shared protocol）
**效能目標**: 檔案樹載入 <5s, 檔案內容渲染 <2s, fallback 回應 <3s
**限制**: Docker-only 部署, read-only viewer, 單一使用者, 檔案存取限制在設定的 project directories
**規模**: 單人使用工具，預估同時開啟 1-3 個專案

### Design References

設計資產為跨 Phase 的專案級檔案，不隸屬於本 feature spec 目錄：

- **UI 設計稿**: `design.pen` — 7 個 screen（Repo Selector, File Browser, Code Viewer, Code Tour, Media Viewer, References List, Tour List）。Foundation 相關：Repo Selector、File Browser、Code Viewer
- **Design Tokens**: `docs/tokens.md` — VSCode Dark+ 色調，定義所有 CSS custom properties（`--{token-name}`）。涵蓋 colors、typography（JetBrains Mono + Inter）、spacing、corner radius、screen dimensions
- **Icon Set**: Lucide（見 tokens.md Iconography 段落）

前端實作時 MUST 遵循 design.pen 的畫面配置與 tokens.md 的 design tokens，確保視覺一致性。

## Constitution Check

*GATE: 必須在 Phase 0 研究前通過。Phase 1 設計後重新檢查。*

| 原則 | 狀態 | 說明 |
|------|------|------|
| I. Mobile-First 設計 | ✅ 通過 | Frontend 以 React + virtual scrolling 針對手機最佳化，touch-friendly UI |
| II. Review 功能優先 | ✅ 通過 | Foundation 聚焦檔案瀏覽與程式碼閱讀，不含編輯功能 |
| III. VSCode 能力最大化 | ✅ 通過 | Extension 透過 `workspace.fs` 讀取檔案，不自建 parser |
| IV. Extension API 委託 | ✅ 通過 | 所有檔案操作委託 Extension API，fallback 為例外（已記錄理由：code-server 離線） |
| V. 後端極簡 | ✅ 通過 | Backend 僅做 proxy/pass-through + path validation + fallback FS 讀取 |
| VI. UI/UX 至上 | ✅ 通過 | 載入狀態、錯誤提示、手機可讀字體、語法高亮皆在設計中 |
| VII. 繁體中文文件規範 | ✅ 通過 | 本 plan 以繁體中文撰寫 |

**技術約束檢查**：
- 前端 React + Shiki ✅
- 後端 Hono ✅
- VSCode 後端 code-server ✅
- Extension 主動 WebSocket 連向 Backend ✅
- Docker Compose 部署 ✅
- 降級策略：Backend 直接讀取檔案系統 ✅

**無違規事項。**

## 專案結構

### 文件（本 feature）

```text
specs/001-foundation/
├── spec.md              # 功能規格
├── plan.md              # 本文件
├── research.md          # Phase 0 研究結果
├── data-model.md        # 資料模型
├── quickstart.md        # 開發環境指南
├── contracts/           # API 與協定合約
│   ├── rest-api.md      # REST API 定義
│   └── ws-protocol.md   # WebSocket JSON-RPC 協定
├── checklists/
│   └── requirements.md  # 規格品質檢查表
└── tasks.md             # Phase 2 任務清單（/speckit.tasks 產出）
```

### 原始碼（repository root）

```text
extension/                    ← VSCode Extension（WebSocket bridge）
├── src/
│   ├── extension.ts          # activate/deactivate entry point
│   ├── bridge-client.ts      # WebSocket client + reconnect + heartbeat
│   ├── pending-requests.ts   # UUID-based request/response correlation
│   ├── protocol.ts           # JSON-RPC 2.0 shared types
│   └── handlers/             # 方法處理器
│       ├── fs.ts             # fs/readDirectory, fs/readFile, fs/stat
│       └── workspace.ts      # workspace/addFolder, workspace/removeFolder
├── package.json
├── tsconfig.json
└── esbuild.mjs               # Bundle config（ws bundled, bufferutil/utf-8-validate external）

backend/                      ← Hono Backend（API gateway + fallback）
├── src/
│   ├── index.ts              # Server bootstrap + injectWebSocket
│   ├── app.ts                # Hono app instance + route mounting（可獨立測試）
│   ├── routes/
│   │   ├── api/
│   │   │   ├── index.ts      # /api route aggregator
│   │   │   ├── projects.ts   # GET /api/projects
│   │   │   ├── files.ts      # GET /api/projects/:id/files, /api/projects/:id/file
│   │   │   └── status.ts     # GET /api/status
│   │   └── ws/
│   │       ├── index.ts      # /ws/vscode-bridge endpoint
│   │       └── bridge.ts     # Bridge connection management + request forwarding
│   ├── services/
│   │   ├── bridge-proxy.ts   # Extension 請求轉發（PendingRequestMap）
│   │   └── fallback-fs.ts    # Fallback：直接讀取檔案系統（Node.js fs）
│   ├── middleware/
│   │   └── path-guard.ts     # 路徑安全驗證（限制在 project roots 內）
│   └── config.ts             # config.json 載入與驗證
├── package.json
├── tsconfig.json
└── Dockerfile

frontend/                     ← React Mobile Viewer
├── src/
│   ├── App.tsx
│   ├── components/
│   │   ├── file-tree/        # 檔案樹元件（lazy load, expand/collapse）
│   │   ├── code-viewer/      # 程式碼檢視器（virtual scroll + token render）
│   │   ├── project-list/     # 專案選擇列表
│   │   └── status-bar/       # Bridge 狀態指示
│   ├── pages/
│   │   ├── home.tsx          # 專案選擇頁
│   │   └── project.tsx       # 檔案瀏覽 + 程式碼閱讀頁
│   ├── services/
│   │   └── api-client.ts     # Backend REST API client
│   ├── workers/
│   │   └── shiki-worker.ts   # Shiki tokenization Web Worker
│   └── hooks/
│       ├── use-file-tree.ts
│       ├── use-file-content.ts
│       └── use-bridge-status.ts
├── package.json
├── tsconfig.json
└── vite.config.ts

packages/                     ← 共享 package
└── protocol/                 # JSON-RPC 2.0 type definitions
    ├── src/
    │   └── index.ts
    └── package.json

docker-compose.yml            ← 三個 service 統一管理
config.json                   ← 專案設定（volume mount）
pnpm-workspace.yaml           ← Monorepo 設定
```

**結構決策**：採用三元件 monorepo + shared protocol package。三個元件透過 `packages/protocol` 共享 JSON-RPC 2.0 type definitions，避免型別定義重複。pnpm workspace 管理 monorepo 依賴。
