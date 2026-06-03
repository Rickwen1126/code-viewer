# Code Annotation via tmux-adapter

Created: 2026-05-21 07:16
Last Updated: 2026-05-21 07:16
Status: handoff-ready implementation spec

## Purpose

This folder is the implementation handoff for connecting Code Viewer annotation
generation to `tmux-adapter`.

Read in this order:

1. [spec.md](./spec.md) — product contract, architecture, API shape, file
   surfaces, implementation phases, acceptance criteria.
2. [handoff@2026-05-21-0716.md](./handoff@2026-05-21-0716.md) — current
   cross-repo state and exact evidence from `tmux-adapter`.

## One-Line Contract

```text
Code Viewer workspace cwd
  -> tmux-adapter ensure-target
  -> reuse active Codex binding or spawn one
  -> send annotation task to that binding
  -> Code Viewer displays generated annotation artifact
```

Code Viewer owns UI intent, selected workspace, selected file, and annotation
artifact display. `tmux-adapter` owns tmux process lifecycle, binding reuse,
spawn fallback, and safe input delivery to Codex.
