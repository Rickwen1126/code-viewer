# Docs Index

This directory stores curated project documents that are meant to be read and reused by humans.

## Canonical Entrypoints

- **[spec.md](./spec.md)** — project-level canonical spec; links to active todo, architecture, code map, and feature specs
- **[todo.md](./todo.md)** — consolidated active todo list (single source of truth for pending work)
- **[todo-finished.md](./todo-finished.md)** — completed/superseded work archive with artifact links

## Top-level folders

- `reference/`: long-lived technical references and checklists. Use these for canonical pitfalls, packaging rules, and reusable validation procedures.
- `demand-driven-watch-list/`: feature spec+plan for replacing activation-time eager watchers with frontend-derived watch list. **Completed.**
- `semantic-location-history/`: feature spec+plan for browser-history-first semantic navigation. **Completed.** Supersedes `git-tour-origin-context/`.
- `desktop-ui/`: desktop layout design — responsive shell with Activity Bar + resizable Sidebar + Main Content. **Implemented.**
- `desktop-authority-mobile-viewer/`: positioning notes for why Code Viewer is a desktop-authority mobile companion.
- `ws-client-singleton-refactor/`: investigation docs for WS client state machine rewrite. **Completed.**
- `code-annotation-tmux-adapter/`: implementation handoff/spec for Code
  Annotation using `tmux-adapter ensure-target + send`. **Implemented.**
- `html-rendered-toggle-preview/`: implemented frontend-only Raw/Rendered HTML
  file viewing in `/files/*`; also records the optional future asset proxy for
  multi-file HTML previews with repo-local relative resources.
- `secretary-scan-follow-up/`: short decision logs for secretary scan findings
  that need repo-local follow-up before implementation or prioritization.
- `superpowers/`: historical design and implementation notes from the earlier MVP push. Treat as historical references.
- `archive/`: old dated todo files and legacy docs, preserved for context.
- `git-tour-origin-context/`: superseded by `semantic-location-history/`. Kept for historical context.
