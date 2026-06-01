# File-Aware Chat

Created: 2026-06-01 22:22
Last Updated: 2026-06-01 23:15
Status: active planning / foundation implementation

This folder tracks the temporary file-aware chat feature for Code Viewer.

The feature direction is to let a user ask short ad-hoc questions from the
current file view. The initial version should automatically include the current
file content as context, optionally insert marked reference lines, and reuse the
same `tmux-adapter` + Codex Spark worker pattern that powers Code Annotation.

Use `plan.md` as the active implementation planning entrypoint.
