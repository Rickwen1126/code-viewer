# Code Viewer

Desktop VS Code 的 Mobile 延伸 — 把電腦上 VS Code 的所有能力搬到手機，觸控優化呈現。

## Problem

用手機進行 AI 開發時，無法有效 code review & preview。vscode.dev 在手機上體驗極差，code-server 的 Extension Host 不穩定且無法使用 Copilot。

## Solution

不重新造輪子，而是利用 Desktop VS Code 已有的全部能力（LSP、Copilot、Git），透過 Extension 將資料送到手機呈現。

```
Desktop VS Code (Extension)  ─WS─  Backend (Hono relay)  ─WS─  Mobile PWA (React)
├─ workspace.fs                     ├─ Connection mgmt              ├─ File tree UI
├─ LSP providers                    ├─ Session cache                ├─ Syntax highlight
├─ Git API                          ├─ Auth                         ├─ Touch navigation
├─ vscode.lm (Copilot)              └─ Pure relay                   ├─ Chat UI
└─ Chat commands                       (no business logic)          └─ Diff review
```

**Core Principle**: Extension gets it → Mobile shows it. Backend is a pure relay.

## Architecture Evolution

本專案經歷了一次重要的架構 pivot，兩個階段的完整設計文件都保留在各自的分支：

### [`001-foundation`](../../tree/001-foundation) — 初始架構

- 基於 code-server (headless) 的架構
- 包含 6 項 Copilot 可行性實驗（全數通過）
- 實驗結果證明 Desktop Extension API 可以完整委託所有 code intelligence
- **結論**：code-server 不需要，直接走 Desktop Extension 更可靠

### [`002-mobile-viewer`](../../tree/002-mobile-viewer) — 當前架構（開發中）

基於 001 實驗結果的架構 pivot：

- **三層架構**：VS Code Extension (WS client) → Hono Relay Backend → React PWA
- **Copilot 鏡像**：Chat 對話接續、Edit Review (approve/reject)、Tool Approval
- **完整文件**：PRD v2、Spec（75 FR）、Protocol、Data Model、69 Tasks

| 文件 | 內容 |
|------|------|
| `specs/002-mobile-viewer/spec.md` | 6 user stories + 75 functional requirements |
| `specs/002-mobile-viewer/plan.md` | 9-phase rollout + tech stack decisions |
| `specs/002-mobile-viewer/tasks.md` | 69 actionable tasks with acceptance criteria |
| `contracts/ws-protocol.md` | WebSocket message format + routing spec |
| `PRD-v2.md` | Product Requirements Document |

## Tech Stack

- **Extension**: TypeScript, VS Code Extension API
- **Backend**: Hono, @hono/node-ws, TypeScript
- **Frontend**: React 19, Shiki v2, Vite, PWA
- **Shared**: pnpm workspaces monorepo, unified protocol types

## Status

SDD (Specification Driven Development) 階段完成，進入實作。
