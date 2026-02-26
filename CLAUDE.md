# Code Viewer

Mobile-first code browsing tool. Uses code-server (headless) as backend intelligence, Hono as API gateway, React + Shiki as mobile viewer.

## Project References

- Constitution (design philosophy & principles): `.specify/memory/constitution.md`
- PRD: `vscode-mobile-view-prd.md`
- Experiment results: `experiments/RESULTS.md`

Architecture and implementation decisions are made through the speckit workflow (spec → plan → tasks), not in this file.

## Hard Rules

- **No custom parsers or type checkers.** All code intelligence MUST go through VSCode Extension API (`execute*Provider` series). No exceptions.
- **Extension never opens a port.** The Extension MUST only act as a WebSocket client connecting outward to Backend. No server/listener inside the Extension.
- **Frontend never touches code-server.** All requests from Mobile Viewer MUST go through Backend. The viewer has no knowledge of code-server's existence.

## Naming Conventions

- Files: `kebab-case.ts`
- Variables / functions: `camelCase`
- Types / interfaces: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`
- API routes: `/api/kebab-case`

## Documentation Language

- Spec, plan, tasks documents: Traditional Chinese (繁體中文)
- Code (variables, comments, commit messages): English
- CLAUDE.md: English

## Boundaries

- This file covers technical implementation rules only. Design philosophy and feature prioritization are governed by the Constitution.
- Architecture, API design, database schema, and project structure decisions belong to the speckit workflow, not this file.
- Experiment results (`experiments/RESULTS.md`) are reference input for speckit design decisions, not hard constraints in this file.

## Known Limitations

- **Extension Host requires a browser session.** code-server is not truly headless — at least one browser connection is needed to start the Extension Host. After disconnect, the host survives ~4+ minutes (bound to server session, not browser).
- **LSP warmup ~3-4 seconds.** Language Servers need time to build type graphs on first query (TypeScript measured at 3-4s).
- **Open-VSX registry only.** code-server uses Open-VSX, not Microsoft Marketplace. Verify extension availability on Open-VSX before depending on it.
- **Workspace conversion may restart extensions.** Switching from single-root to multi-root workspace can trigger extension reload.
