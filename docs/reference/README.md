# Reference

Long-lived technical references, checklists, and known pitfalls that stay valid across multiple tasks.

## Files

- `extension-vsix-packaging.md`: canonical notes for building, packaging, installing, and validating the Code Viewer VSIX. Includes the known `Cannot find module 'ws'` failure mode and the guardrails that prevent it.
- `signal-vs-settled-truth.md`: reusable timing model for event-driven systems. Explains why watcher/websocket signals are often invalidation only, not settled state, and how to design follow-up reload/settle strategies safely.
