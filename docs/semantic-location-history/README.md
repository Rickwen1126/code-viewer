# Semantic Location History

This folder is the active-topic home for the broader navigation contract that now covers:

- code-to-code semantic jumps such as Go to Definition and References
- Git diff -> Code Viewer -> return
- CodeTour -> Code Viewer -> return
- browser-history-first deep linking for semantic locations

## Canonical doc

- `spec.md`: canonical navigation contract for semantic URLs, browser history integration, and detour unwind behavior
- `plan.md`: implementation plan with a required Phase 0 audit of current local cache / restore behaviors so high-value UX is preserved during migration
- `cache-audit.md`: current inventory of localStorage, IndexedDB, route-state, and restore behaviors that Phase 1 must not accidentally break

## Relationship to older docs

- `docs/git-tour-origin-context/spec.md` is the earlier narrower precursor that only covered Git/Tour return-context. Keep it for historical context, but use this folder as the current source of truth.
