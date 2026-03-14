# Implementation Plan: Mobile Code Viewer

**Branch**: `002-mobile-viewer` | **Date**: 2026-03-14 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-mobile-viewer/spec.md`

## Summary

將 Desktop VS Code 的完整能力（檔案瀏覽、LSP、Git、Copilot）透過
Extension → Backend relay → Mobile Viewer 三層架構搬到手機上。
Extension 為 WS client 連向 Backend，Backend 為純 relay，
Frontend 為 React + Shiki 的觸控優化 PWA。

## Technical Context

**Language/Version**: TypeScript 5.x（三端統一）
**Primary Dependencies**:
- Extension: `vscode` API, `ws`（WS client）
- Backend: `hono` + `@hono/node-ws` + `@hono/node-server`
- Frontend: `react` 19, `shiki` v2（JS engine）, `react-shiki`, React Router v7, `@tanstack/react-virtual`, `diff`（jsdiff）
- Shared: 共用 WS message 型別定義（`packages/shared`）

**Storage**: Backend 記憶體快取（session state）；Frontend localStorage/IndexedDB（離線快取）
**Testing**: Vitest（unit + integration）
**Target Platform**: Mobile Safari/Chrome（PWA）、Node.js/Bun backend、VS Code Extension
**Project Type**: Web application（monorepo，3 packages + shared）
**Performance Goals**:
- 開啟 app → 檔案樹：< 5s
- 檔案內容 + 語法高亮：< 2s
- Go to Definition：< 3s
- Chat streaming 首字：< 5s
- 觸控回應：< 200ms（不含網路）

**Constraints**: 離線時已快取內容可瀏覽、單一使用者、Tailscale 內網
**Scale/Scope**: 1 使用者、多 VS Code 實體（~5-10）、~13 畫面

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原則 | 狀態 | 驗證 |
|------|------|------|
| §I Mobile-First | ✅ PASS | 44x44pt 觸控目標、單手操作、手勢優先、深色舒適 |
| §II Review 優先 | ✅ PASS | P1-P3 為檔案瀏覽 + Code Intelligence + Git，review 核心功能優先 |
| §III VSCode 能力最大化 | ✅ PASS | 所有 intelligence 來自 Desktop VS Code Extension API |
| §IV Extension API 委託 | ✅ PASS | workspace.fs、LSP providers、Git API、vscode.lm 全部委託 |
| §V 後端極簡 | ✅ PASS | Backend 純 WS relay + session cache，不含業務邏輯 |
| §VI UI/UX 至上 | ✅ PASS | 完整 UI/UX 體驗設計段落、Design Tokens 沿用、13 畫面規劃 |
| §VII 繁體中文 | ✅ PASS | spec/plan/tasks 以繁體中文撰寫 |
| §VIII Copilot 鏡像 | ✅ PASS | Chat/Edit Review/Tool Approval 全部透過 VS Code API + Commands |

**技術約束驗證**：
- ✅ Frontend: React + Shiki
- ✅ Backend: Hono
- ✅ VSCode: Desktop VS Code Extension
- ✅ 通訊: Extension WS client → Backend（Extension 不開 port）
- ✅ API 穩定度: 優先使用 Public API 層級

**GATE RESULT: ALL PASS** — 進入 Phase 0。

### Post-Phase 1 Re-check

| 原則 | 狀態 | 驗證 |
|------|------|------|
| §I Mobile-First | ✅ PASS | data-model 無 desktop-specific 欄位；WS protocol 支援 streaming |
| §II Review 優先 | ✅ PASS | message-types 中 file/lsp/git 為核心 domain，chat/review 為後續 |
| §III VSCode 能力最大化 | ✅ PASS | lsp.* 訊息委託 Extension execute*Provider；file.* 委託 workspace.fs |
| §IV Extension API 委託 | ✅ PASS | data-model 所有資料來源為 Extension；Backend 純 relay |
| §V 後端極簡 | ✅ PASS | Backend 只做 WS relay + Map-based 快取，無業務邏輯 |
| §VI UI/UX 至上 | ✅ PASS | research 確認 Shiki Dark+ 主題、react-shiki、View Transitions |
| §VII 繁體中文 | ✅ PASS | 所有 spec/plan/research/contracts 文件為繁體中文 |
| §VIII Copilot 鏡像 | ✅ PASS | chat.send → Extension → vscode.lm/commands；review.* → commands |

**POST-DESIGN GATE: ALL PASS**

## Project Structure

### Documentation (this feature)

```text
specs/002-mobile-viewer/
├── plan.md              # 本文件
├── research.md          # Phase 0: 技術研究
├── data-model.md        # Phase 1: 資料模型
├── quickstart.md        # Phase 1: 快速啟動指南
├── contracts/           # Phase 1: WS 協定 + API 定義
│   ├── ws-protocol.md   # WebSocket 訊息格式
│   └── message-types.md # 完整訊息型別清單
└── tasks.md             # Phase 2: 任務清單（/speckit.tasks 產出）
```

### Source Code (repository root)

```text
packages/
└── shared/              # 共用型別定義
    └── src/
        ├── ws-types.ts  # WS 訊息型別（Extension/Backend/Frontend 共用）
        └── models.ts    # 共用資料模型

extension/               # VS Code Extension（WS client）
├── src/
│   ├── extension.ts     # Entry point, activation
│   ├── providers/       # File, LSP, Git, Copilot 各 provider
│   │   ├── file-provider.ts
│   │   ├── lsp-provider.ts
│   │   ├── git-provider.ts
│   │   └── copilot-provider.ts
│   └── ws/
│       └── client.ts    # WS client, auto-reconnect, message routing
├── package.json
└── tsconfig.json

backend/                 # Hono WebSocket Relay
├── src/
│   ├── index.ts         # Entry point, Hono app
│   ├── ws/
│   │   ├── manager.ts   # 多 Extension 連線管理
│   │   ├── relay.ts     # Frontend↔Extension 訊息轉發
│   │   └── handler.ts   # WS upgrade + routing
│   └── cache/
│       └── session.ts   # 記憶體快取（session state, file tree）
├── package.json
└── tsconfig.json

frontend/                # React Mobile PWA
├── src/
│   ├── app.tsx          # Root app, router setup
│   ├── components/      # 共用 UI 元件
│   │   ├── code-block.tsx     # Shiki 語法高亮元件
│   │   ├── diff-view.tsx      # Diff 檢視元件
│   │   ├── action-sheet.tsx   # Bottom action sheet
│   │   ├── connection-status.tsx
│   │   └── tab-bar.tsx
│   ├── pages/           # 各 Tab 頁面
│   │   ├── workspaces/  # Workspace Selector
│   │   ├── files/       # File Browser + Code Viewer
│   │   ├── git/         # Git Changes + Diff
│   │   ├── tours/       # Tour List + Tour Detail
│   │   ├── chat/        # Chat Session List + Conversation
│   │   └── review/      # Edit Review + Tool Approval
│   ├── hooks/           # React hooks
│   │   ├── use-websocket.ts
│   │   ├── use-workspace.ts
│   │   └── use-cache.ts
│   └── services/
│       ├── ws-client.ts # WebSocket 連線管理
│       └── cache.ts     # 離線快取（IndexedDB）
├── public/
│   └── manifest.json    # PWA manifest
├── package.json
└── tsconfig.json

pnpm-workspace.yaml      # Monorepo 配置
```

**Structure Decision**: 採用 monorepo（pnpm workspaces），3 個 package（extension、backend、frontend）
加 1 個 shared package。理由：三端共用 WS 訊息型別，統一 TypeScript 版本和 lint 設定。

## Complexity Tracking

> 無 Constitution 違規項目，不需要填寫。
