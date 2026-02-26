# VSCode Mobile Viewer PRD

## Problem

目前使用 Sourcegraph 作為手機端 code browsing 方案，存在以下根本性問題：

1. **必須 push 到 git 才能看** — 與 local 開發優先的工作流衝突
2. **gitignore 的檔案看不到** — generated code、config、build artifacts 都被排除
3. **太重** — 完整的 SG server 只為了手機看 code，資源浪費
4. **Code intelligence 受限** — 未設定 SCIP indexer 的情況下，SG 的跳轉精度等同 ctags + 搜尋

## Solution

用 **code-server（headless）** 作為後端，直接寄生在 VSCode 的完整能力上，搭配自建的 mobile-optimized viewer。不重造任何 parser，只做 render。

## Architecture

```
┌─────────────────────────────────────────────┐
│  Docker                                      │
│                                              │
│  ┌──────────────┐     ┌───────────────────┐ │
│  │ code-server   │     │  Backend (Hono)   │ │
│  │ (headless)    │←ws→ │                   │ │
│  │               │     │  - Auth           │ │
│  │ - Extension   │     │  - REST API       │ │
│  │ - LSP servers │     │  - Tour engine    │ │
│  │ - Git         │     │  - Q&A system     │ │
│  │               │     │  - Cache layer    │ │
│  └──────────────┘     └────────┬──────────┘ │
│                                │             │
│  ┌──────────────┐              │             │
│  │ Cloudflared   │←────────────┘             │
│  └──────────────┘                            │
└────────────────────────────────────────────  ┘
                       │
                       ▼ HTTPS
                 ┌───────────┐
                 │  Mobile    │
                 │  Viewer    │
                 └───────────┘
```

### 三層職責

| 層 | 職責 | 技術 |
|---|------|------|
| **code-server** | 全部的 "thinking"：LSP、檔案系統、Git、diagnostics | code-server + VSCode Extension |
| **Backend** | 中間層：Auth、路由、快取、Tour、問答、fallback | Hono (已有 infra) |
| **Mobile Viewer** | 純 "display"：語法高亮、touch UI、手機最佳化 layout | React + Shiki |

### 為什麼選 code-server 而非 desktop VSCode Extension

- **Desktop Extension 的問題**：每個 VSCode 視窗各自跑一個 Extension instance，Backend 需要自己做 service discovery 來路由請求
- **code-server 的優勢**：單一 instance、單一連線、無路由問題、不需要桌面 VSCode 開著、可以動態開關 workspace folder

### 通訊方式

- Extension **主動連向** Backend（WebSocket），不是 Backend 連 Extension
- Extension 不開 port，沒有暴露問題
- Extension 重啟自動重連
- Backend 透過連線狀態知道 code-server 是否在線

## Features

### Core: Code Viewing

| 功能 | 來源 | 說明 |
|------|------|------|
| 檔案瀏覽 | `workspace.fs.readDirectory` | 含 gitignored 檔案、未存檔修改 |
| 檔案內容 | `workspace.fs.readFile` | 任意路徑，不限 workspace |
| 語法高亮 | Shiki（前端） | 前端渲染，不經過 Extension |
| 手機最佳化 | 自建 UI | 大字體、swipe 導航、touch-friendly |

### Core: Code Intelligence（全部 proxy VSCode LSP）

| 功能 | VSCode API | Fallback（code-server 離線） |
|------|-----------|---------------------------|
| Go to definition | `executeDefinitionProvider` | ctags |
| Find all references | `executeReferenceProvider` | grep |
| Hover（型別 + 文件）| `executeHoverProvider` | 無 |
| Symbol 列表 | `executeDocumentSymbolProvider` | Tree-sitter |
| Workspace symbol 搜尋 | `executeWorkspaceSymbolProvider` | ctags |
| Go to type definition | `executeTypeDefinitionProvider` | 無 |
| Go to implementation | `executeImplementationProvider` | 無 |
| 錯誤 / 警告 | `getDiagnostics` | 無 |
| Git 狀態 | Git extension API | git CLI |

### Core: Search

| 功能 | 實作 | 說明 |
|------|------|------|
| 全文搜尋 | ripgrep（Backend 直接跑） | 不需要 LSP |
| Fuzzy file search | fuse.js | 檔名模糊搜尋 |
| Fuzzy symbol search | ctags + fuse.js | Symbol 模糊搜尋 |

### Core: Tour Integration

- Tour step 直接在 Code Viewer 裡渲染（取代 Sourcegraph URL）
- `.tours/` 檔案從 local filesystem 讀取（已有邏輯）
- 不再依賴 `sgRepo` 欄位構造 Sourcegraph URL

### Feature: Q&A Annotation System

手機端讀 code 時快速標註問題，電腦端用 AI 回答。

**手機端（提問）：**
- 長按選行範圍 → 打字問問題 → 送出
- 問題結構：

```json
{
  "id": "q-20260219-001",
  "question": "這個 middleware chain 為什麼要這樣排序？",
  "refs": [
    { "file": "src/server.ts", "lines": [42, 58] },
    { "file": "src/middleware/auth.ts", "lines": [1, 30] }
  ],
  "status": "pending",
  "answer": null
}
```

**電腦端（回答）：**
- CLI script 讀取 pending questions
- 將 ref files + line ranges 組成 context
- 呼叫 Claude API / `claude` CLI 生成回答
- 寫回 database，手機端刷新即可看到

**為什麼這比內建 AI 好：**
- 不用在 web server 跑 AI — 省成本、省複雜度
- Context 品質更高 — CLI 端可以塞整個 repo 的 context
- 回答可以被 review — 持久化的知識，不是即時消失的 chat

## Graceful Degradation

```
code-server 在線：
  Mobile → Backend → Extension → LSP → compiler-level 精度（99%）

code-server 離線：
  Mobile → Backend → Tree-sitter / ctags fallback → 基本功能照用（~85%）
```

Backend 統一 API，Mobile viewer 不需要知道後面是誰在回答。

## Workspace 管理

- code-server 支援 **動態加入 workspace folder**：`workspace.updateWorkspaceFolders()`
- 手機端選 project → Extension 自動開 workspace → LSP 啟動 → 全功能可用
- 不活躍的 workspace folder 自動 timeout 移除，控制記憶體
- 專案列表來自 `config.json`（已有）

## Backend API Design

```
Backend REST API
├── GET  /api/files/{path}          ← 檔案瀏覽（fs 或 Extension）
├── GET  /api/file/{path}           ← 檔案內容
├── GET  /api/search?q=...          ← ripgrep 全文搜尋
├── GET  /api/symbols?file=...      ← Extension 或 Tree-sitter
├── GET  /api/definition?file=&line=&col=   ← Extension 或 ctags
├── GET  /api/references?file=&line=&col=   ← Extension 或 grep
├── GET  /api/hover?file=&line=&col=        ← Extension only
├── GET  /api/diagnostics?file=...          ← Extension only
├── GET  /api/tours/{project}       ← Tour 邏輯（已有）
├── GET  /api/tours/{project}/{tour}
├── POST /api/questions             ← 建立問題
├── GET  /api/questions?status=pending      ← 列出問題
├── PUT  /api/questions/{id}        ← 更新答案
└── WS   /ws/vscode-bridge          ← Extension 連入點
```

## Implementation Phases

### Phase 1: Foundation

- [ ] code-server Docker service（加入 docker-compose）
- [ ] VSCode Extension：WebSocket bridge + 基本 file API
- [ ] Backend：bridge 管理 + file browsing API
- [ ] Mobile：檔案瀏覽器 + Shiki 語法高亮 + 手機 layout

### Phase 2: Code Intelligence

- [ ] Extension：proxy 全部 LSP commands
- [ ] Backend：統一 code intelligence API + fallback 策略
- [ ] Mobile：tap 跳轉、hover tooltip、symbol 列表、error 標記
- [ ] Workspace 動態管理

### Phase 3: Search

- [ ] Backend：ripgrep 全文搜尋
- [ ] Backend：ctags + fuse.js fuzzy search
- [ ] Mobile：搜尋 UI（全文 + fuzzy file + fuzzy symbol）

### Phase 4: Tour Integration

- [ ] Tour step 在 Code Viewer 裡渲染
- [ ] 移除 Sourcegraph URL 依賴
- [ ] config.json 的 `sgRepo` 變成 optional

### Phase 5: Q&A Annotation

- [ ] Mobile：選行範圍 + 提問 UI
- [ ] Backend：問答 CRUD API（SQLite）
- [ ] CLI script：批次用 AI 回答 pending questions
- [ ] Mobile：顯示答案

### Phase 6: Cleanup

- [ ] 移除 Sourcegraph Docker service
- [ ] 更新 config.json schema
- [ ] 文件更新

## Key Design Decisions

1. **不重造 parser** — 所有語言支援繼承 VSCode 生態系
2. **語法高亮在前端做** — Shiki 在瀏覽器跑，不經 Extension（避免傳 token map）
3. **搜尋不經 LSP** — ripgrep 直接在 Backend 跑，不依賴 code-server 在線
4. **問答與 AI 解耦** — 手機只負責提問，AI 回答在電腦端離線處理
5. **Graceful degradation** — code-server 離線時自動降級到 Tree-sitter/ctags

## Comparison: Before vs After

```
Before:
  Sourcegraph (heavy) + Web Tour + Cloudflared
  - 3 Docker services
  - Must push to git
  - Can't see gitignored files
  - SG is core dependency
  - Mobile UX limited by SG

After:
  code-server (headless) + Backend (Hono) + Cloudflared
  - 3 Docker services (but code-server << SG in resource usage)
  - Reads local filesystem directly
  - All files visible
  - code-server is optional accelerator (fallback exists)
  - Mobile UX fully controlled
  - IDE-level code intelligence
  - Integrated Tour + Q&A
```
