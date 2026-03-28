# Code Viewer

Desktop VS Code 的 Mobile 延伸 — 把電腦上 VS Code 的所有能力搬到手機，觸控優化呈現。

## Problem

用手機進行 AI 開發時，無法有效 code review & preview。vscode.dev 在手機上體驗極差，code-server 的 Extension Host 不穩定且無法使用 Copilot。

## Solution

不重新造輪子，而是利用 Desktop VS Code 已有的全部能力（LSP、Copilot、Git），透過 Extension 將資料送到手機呈現。

```
Desktop VS Code (Extension)  ─WS─  Backend (Hono relay :4800)  ─WS─  Mobile PWA (React :4801)
├─ workspace.fs                     ├─ Connection mgmt              ├─ File tree + search
├─ LSP providers                    ├─ Session cache                ├─ Syntax highlight (Shiki)
├─ Git API                          ├─ Auth                         ├─ Touch navigation
├─ vscode.lm (Copilot)              └─ Pure relay                   ├─ Git diff + commit history
└─ CodeTour                            (no business logic)          ├─ CodeTour viewing + recording
                                                                    └─ Cache-first offline
```

**Core Principle**: Extension gets it → Mobile shows it. Backend is a pure relay.

## Features

### Code Viewer
- Syntax highlighting (Shiki) with VS Code → Shiki language mapping
- Line numbers with tap-to-bookmark (gold star gutter indicator)
- Horizontal scroll (default) + word-wrap toggle
- Pinch-to-zoom font size (persisted per session)
- Tap-on-code popover: hover type info + Go to Definition / Find References
- Go to Definition highlight (3s blue fade)
- In-file search with instant highlight, prev/next navigation, match count
- Markdown preview with Raw/Rendered toggle

### File Browser
- File tree with expand/collapse state memory (localStorage)
- Current file highlight (blue left border + auto-expand)
- Collapse All + Recovery (restore previous state)
- Fuzzy file search (from cached tree, works offline)
- Recent files (last 15, shown on search focus)
- Workspace name shown in toolbar

### Bookmarks
- Tap line number to toggle bookmark
- Gold star gutter indicator
- Header badge with bookmark count
- Bookmark browser: jump to any bookmarked line

### Git
- Branch info + ahead/behind count
- Staged vs unstaged files split
- Added files rendered with full-content all-green diff
- Commit history (last 30) with author, message, relative date
- Click commit → file list → click file → view diff
- Diff view: unified format, full-width background colors

### CodeTour
- Browse and view existing `.tour` files per workspace
- Step-by-step navigation with syntax-highlighted code context
- Markdown-rendered step descriptions
- Selection highlight and line offset display
- **Recording**: create new tours, add/edit/delete steps, all persisted immediately via WS
- Step+ toggle mode: while active, tapping code adds a step to the current tour
- Edit step: update description, title, selection range
- Context-only steps (no file/line) for narrative sections
- Copy tour file path from Tours list

### Multi-Workspace
- Connect multiple VS Code workspaces simultaneously
- Workspace selector with active highlight (blue border)
- Per-workspace file tree, git state, and tour data
- Auto-rebind workspace on reconnect

### Session Resilience
- Auto-restore last viewed file on reconnect
- Persist word-wrap, scroll position, font size per workspace
- Cache-first loading: IndexedDB cache → instant display → background refresh
- Safari zombie WS detection (visibilitychange + readyState check)
- Error Boundary: React crash → "Reload App" button (not gray screen)

### PWA
- Service Worker for app shell caching
- Manifest + apple-mobile-web-app meta tags
- WS URL auto-derives from `window.location.hostname` (LAN/Tailscale)

## Quick Start

### Development Mode

```bash
# Prerequisites: Node.js >= 20, pnpm 9.x, VS Code >= 1.100
pnpm install

# Start backend + frontend
pnpm --filter @code-viewer/backend dev    # → :4800
pnpm --filter @code-viewer/frontend dev   # → :4801

# Extension: VS Code F5 → "Run Extension"
# Or: node tests/e2e/launch-extension.mjs --real

# Open http://localhost:4801 (or LAN IP on phone)
```

### CLI

```bash
# From project root (CLI not yet published to npm)
pnpm --filter @code-viewer/cli dev start ~/code/my-project

# Multiple repos simultaneously
pnpm --filter @code-viewer/cli dev start ~/code/another-project

# Stop
pnpm --filter @code-viewer/cli dev stop
```

### Extension Behavior

- Extension 由 workspace setting 控制：`codeViewer.enabled`（default: `false`）
- `false` → 完全靜默，零干擾
- `true` → 自動連線 backend
- Setting 變更即時生效，不需 reload VS Code
- CLI 自動寫入 `.vscode/settings.json`
- 手動：Cmd+Shift+P → "Code Viewer: Connect to Backend"
- 關閉：Setting 改 `false` 或 Cmd+Shift+P → "Code Viewer: Disconnect"

## Testing

- **196 unit tests** (Vitest) across all packages
- **47-item E2E checklist** with three-layer log verification:
  - Frontend `[ws]` logs (localStorage `code-viewer:debug=true`)
  - Backend `[relay]` logs (env `CODE_VIEWER_DEBUG=true`)
  - Extension `[CodeViewer]` logs (VS Code setting `codeViewer.debug`)
- Pass criteria: UI screenshot + console log consistency + round-trip data persistence
- iPhone viewport (390x844) for all E2E tests

```bash
pnpm -w run test              # Run all unit tests
pnpm -r typecheck             # Typecheck all packages
```

## Known Issues

### iOS Safari: iCloud Private Relay

**如果 iPhone Safari 連不上 WebSocket（卡在 loading workspace），請關閉 iCloud 私密轉送：**

設定 → Apple ID → iCloud → 私密轉送 → **關閉**

Private Relay 會將 WebSocket 連線走 Apple relay server，導致 WS upgrade 失敗或極度延遲。即使設定頁顯示「關閉」，可能需要重啟 Safari 才生效。Chrome iOS 不受此影響。

### iOS Safari: Background WS Disconnect

iOS Safari 會在 app 切到背景後 30-60 秒內 suspend WebSocket 連線，且不觸發 `onclose` event（WebKit Bug #247943）。已內建自動重連機制：visibilitychange 偵測 + zombie WS detection + cache-first 顯示。

## Tech Stack

- **Extension**: TypeScript, VS Code Extension API
- **Backend**: Hono, @hono/node-ws, TypeScript
- **Frontend**: React 19, Shiki v3, Vite, PWA
- **Shared**: pnpm workspaces monorepo, unified WebSocket protocol types

## Architecture

本專案經歷了一次架構 pivot：

### `001-foundation` — 初始架構

- 基於 code-server (headless) 的架構
- 6 項 Copilot 可行性實驗（全數通過）
- **結論**：code-server 不需要，直接走 Desktop Extension 更可靠

### `002-mobile-viewer` → `main` — 當前架構

- **三層架構**：VS Code Extension → Hono Relay Backend → React PWA
- 6 user stories, 75 functional requirements, 69 implementation tasks
- 196 unit tests, 47 E2E verification items
- Cache-first, offline-capable, mobile-optimized

| 文件 | 內容 |
|------|------|
| `specs/002-mobile-viewer/spec.md` | 6 user stories + 75 FRs |
| `specs/002-mobile-viewer/plan.md` | 9-phase rollout |
| `CLAUDE.md` | Development guidelines |

## License

Private
