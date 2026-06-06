# Code Viewer — Canonical Spec

Created: 2026-03-14
Last Updated: 2026-06-06 14:24
Status: Active

## Purpose

Desktop VS Code 作為 primary Extension Host，透過 WebSocket relay 將 code browsing 能力投射到 mobile PWA 前端。核心定位：**desktop-authority mobile companion**，不是 browser IDE 或 generic mobile code editor。

## Architecture

```
Desktop VS Code (Extension)  ─WS─  Backend (Hono relay :4800)  ─WS─  Frontend PWA (React :4801)
```

pnpm monorepo: `packages/shared`, `backend`, `extension`, `frontend`

## Canonical Entrypoints

- Active todo: [docs/todo.md](./todo.md)
- Completed todo archive: [docs/todo-finished.md](./todo-finished.md)
- Development guidelines: [CLAUDE.md](../CLAUDE.md)
- Session continuity: [.progress/progress.md](../.progress/progress.md)

## Architecture Diagram

- Sky Eye overview: `.tours/01-architecture-skyeye-code-viewer.tour`

## Code Map / CodeTour

| Tour | Scope |
|------|-------|
| `01-architecture-skyeye-code-viewer.tour` | 全系統架構 |
| `02-edit-step-boundary-code-viewer.tour` | Edit/step boundary |
| `03-demand-driven-sync-code-viewer.tour` | Demand-driven sync |
| `04-demand-driven-watch-list-code-viewer.tour` | Watch list lifecycle |
| `05-semantic-location-history-code-viewer.tour` | Semantic navigation |
| `06-diff-tour-step-links-code-viewer.tour` | Diff/tour step links |
| `07-phase2-state-cleanup-code-viewer.tour` | State cleanup |
| `ws-client-singleton-refactor-20260507.tour` | WS client state machine |

## Feature Specs (per-feature docs)

| Feature | Folder | Status |
|---------|--------|--------|
| Demand-driven watch list | `docs/demand-driven-watch-list/` | Completed |
| Semantic location history | `docs/semantic-location-history/` | Completed |
| Desktop UI | `docs/desktop-ui/` | Implemented (spec draft) |
| WS client singleton refactor | `docs/ws-client-singleton-refactor/` | Completed |
| Desktop authority positioning | `docs/desktop-authority-mobile-viewer/` | Reference |
| Code annotation via tmux-adapter | `docs/code-annotation-tmux-adapter/` | Implemented (stophook-gated completion) |
| HTML rendered toggle preview | `docs/html-rendered-toggle-preview/` | Planning |

## Learning Artifacts

| Type | Location |
|------|----------|
| SHIP records | `.ship/` |
| BANK knowledge extracts | `.bank/` |
| Review CodeTours | `.tours/review-*.tour` |

## Source Of Truth Rules

- `docs/spec.md` (this file) is the project-level canonical entrypoint
- Per-feature specs live in their own `docs/<feature>/spec.md`
- `.progress/` is session continuity for agents, not canonical project state
- `docs/todo.md` is the single active todo list; old dated files in `docs/archive/` are legacy
