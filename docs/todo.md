# Code Viewer — Active Todo

## P1: Known Improvements @2026-05-12-1635

Section source:

- Spec: various, accumulated from progress sessions
- Code/Surface: mixed

- [ ] PWA fix: PNG icons, apple-touch-icon, manifest scope, SW cache versioning
  - Code: `frontend/public/`, `frontend/index.html`
  - Source: migrated from legacy todo; original source refs were not recorded
- [ ] File tree lazy load — 只載入當前展開層，展開時 fetch children
  - Code: `extension/src/providers/file-provider.ts`, shared `FileTreeNode`, frontend file tree
  - Source: `docs/archive/2026-04-23.md`
- [ ] Go to definition 外部檔案存取（受控放寬）
  - Code: `extension/src/providers/lsp-provider.ts`
  - Source: migrated from progress.md; original source refs were not recorded

## P2: Infrastructure @2026-05-12-1635

- [ ] Production reverse proxy 設定
  - Source: migrated from legacy todo; original source refs were not recorded

## Backlog @2026-05-12-1635

- [ ] Extension Copy Mobile Link command
  - Source: `docs/archive/2026-04-13.md` — deferred, backend/CLI deep-link surface 已可用
  - Follow-up: reconcile this item into the relevant spec/plan before implementation
- [ ] Optional HTML asset proxy for multi-file previews
  - Plan: `docs/html-rendered-toggle-preview/plan.md`
  - Code/Surface: backend asset HTTP route, shared/extension `file.asset` protocol, `frontend/src/components/html-renderer.tsx`
  - Source: follow-up from shipped frontend-only HTML render; only needed when HTML previews must resolve repo-local relative CSS/images/scripts
