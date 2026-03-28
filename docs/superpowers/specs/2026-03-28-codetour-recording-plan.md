# CodeTour Recording UI — Implementation Plan

**Date**: 2026-03-28
**Status**: Approved
**Scope**: Pure frontend — no backend/extension changes needed

---

## Core Design: Reference Point, Not Recording Mode

There is no "recording mode." Instead, the system uses a **reference point** — a pointer indicating which tour and where to insert the next step.

```
Tour Steps: [Step1] → [Step2] → [Step3]
                              ↑
                        Reference Point
                     (next step inserts here)
```

After adding a step, the reference point advances by 1 (like a linked list cursor).

### Why No Recording Mode

Each step is immediately persisted to the backend via `tour.addStep`. The `.tours/` file always has the latest data. Therefore:

- **No finalize needed** — backend already has complete data
- **No crash recovery** — nothing to recover (all saved)
- **No offline queue** — if WS is down, wait for reconnect
- **No workspace lock** — if workspace mismatches, just clear the pointer
- **No state machine** — just a nullable pointer object

### Frontend State

```typescript
interface TourEditState {
  tourId: string          // which tour
  tourTitle: string       // display name
  extensionId: string     // workspace guard
  afterIndex: number      // insert position (-1 = prepend, 0 = after first, etc.)
}

// localStorage: 'code-viewer:tour-edit'
// Cleared on: user taps Done, workspace mismatch, or manual clear
```

---

## UI Components

### 1. Step+ Toggle (code-viewer header)

Added to the header button row alongside Wrap, Symbols, Search:

| State | Appearance | Line Number Behavior |
|-------|-----------|---------------------|
| OFF (default) | `Step+` grey text, inactive | tap = bookmark |
| ON | `Step+` active bg + tour name | tap = add step |

- Toggle auto-activates when reference point is set (navigating from Tours page)
- Toggle OFF = clear reference point
- Only visible when a reference point exists (otherwise hidden to avoid clutter)

### 2. Tours Page — Entry Points

#### New Tour
- Button at top of tour list: `+ New Tour`
- Tap → name input (inline or alert) → `tour.create` → set reference point at index -1 → navigate to Files tab

#### Add Steps to Existing Tour
- Each tour in the list gets an `Edit` button
- Tap → set reference point at last step index → navigate to Files tab
- Alternatively: in tour detail, tap a specific step → set reference point after that step

### 3. Add Step Flow (Full-Screen Overlay)

Triggered when: Step+ is ON + user taps a line number.

#### Screen 1: Line Range

```
┌──────────────────────────────────────┐
│ Add Step to: {tour name}             │
│                                      │
│ File: src/index.ts                   │
│                                      │
│ Start line: [42         ]            │
│ End line:   [42         ] [Auto]     │
│                                      │
│ [Auto] = use lsp.documentSymbol to   │
│ find enclosing function/class range  │
│ (greyed out if LSP unavailable)      │
│                                      │
│ [Cancel]                   [Next →]  │
└──────────────────────────────────────┘
```

- Start line pre-filled from tapped line number
- End line defaults to same as start (single line)
- `Auto` button: calls `lsp.documentSymbol`, finds the symbol that contains the start line, fills endLine
- If LSP unavailable: Auto button disabled, manual only

#### Screen 2: Description Editor (Structured Markdown)

```
┌──────────────────────────────────────┐
│ src/index.ts:42-58                   │
│                                      │
│ Section 1                        [🗑] │
│ ┌──────────────────────────────────┐ │
│ │ Title (## heading)               │ │
│ ├──────────────────────────────────┤ │
│ │ Content                          │ │
│ │ (multi-line textarea)            │ │
│ └──────────────────────────────────┘ │
│                                      │
│ Section 2                        [🗑] │
│ ┌──────────────────────────────────┐ │
│ │ Title                            │ │
│ ├──────────────────────────────────┤ │
│ │ Content                          │ │
│ └──────────────────────────────────┘ │
│                                      │
│          [+ Add Section]             │
│                                      │
│ [← Back]                    [Save]   │
└──────────────────────────────────────┘
```

**Behavior:**
- Default: 1 section (title + content)
- `+ Add Section` → append new section
- 🗑 → delete section (minimum 1 section required)
- Save → combine sections: `## {title}\n{content}\n\n## {title2}\n{content2}`
- Save → `tour.addStep({ tourId, file, line, endLine, description, index: afterIndex + 1 })`
- After save → reference point advances: `afterIndex += 1`
- Cancel → discard, no WS call

### 4. Tour Detail — Edit & Delete Steps

Each step in the detail view shows:
- Step content (existing: description, code snippet)
- `Edit` button → opens description editor (Screen 2 only, same structured UI)
  - **Can only edit description content** — file, line, endLine are locked
  - Reason: changing file/line could break ref/commit alignment. Delete + re-add instead.
- `Delete` button → confirm → `tour.deleteStep({ tourId, stepIndex })`

### 5. Workspace Guard

On every navigation and on workspace change event:

```typescript
if (tourEditState && tourEditState.extensionId !== workspace.extensionId) {
  clearTourEditState()  // auto-clear reference point
}
```

No lock, no warning. Just silently clear. Steps are already saved.

---

## Implementation Tasks

### MVP (must-have)

| # | Task | Size | Depends |
|---|------|------|---------|
| 1 | `TourEditContext` provider + localStorage | S | — |
| 2 | Tours page: `+ New Tour` button + name input + tour.create | S | #1 |
| 3 | Tours page: `Edit` button → set reference point + navigate | S | #1 |
| 4 | Code-viewer header: `Step+` toggle button | S | #1 |
| 5 | Add Step overlay: Screen 1 (line range, start/end inputs) | M | #4 |
| 6 | Add Step overlay: Screen 2 (structured description editor) | M | #5 |
| 7 | Save → `tour.addStep` + reference point advance | S | #6 |
| 8 | Tour detail: Edit step description | S | — |
| 9 | Tour detail: Delete step | S | — |
| 10 | Workspace guard: auto-clear reference point on mismatch | S | #1 |

### Polish (nice-to-have, after MVP)

| # | Task | Size |
|---|------|------|
| 11 | Symbol auto-fill: `lsp.documentSymbol` → endLine | S |
| 12 | Selection range support in addStep (character-level highlight) | S |
| 13 | Verify selection highlight renders correctly with real data | — |
| 14 | Step reorder (needs new backend API `tour.reorderSteps`) | L |
| 15 | Bottom sheet variant for desktop (instead of full-screen) | M |

---

## What We Explicitly Don't Do

| Decision | Reason |
|----------|--------|
| No recording mode / state machine | Each step immediately persisted; no intermediate state to manage |
| No finalize API call | Backend `tour.finalize` only removes a status flag; not needed if we don't set status |
| No offline queue | Recording happens near desktop (VS Code must be running); WS usually available |
| No preview during editing | Structured editor (title + content sections) is already predictable |
| No edit file/line on existing step | Prevents ref/commit misalignment; delete + re-add is safer |
| No step reorder in MVP | API doesn't support it; delete + re-insert works as workaround |

---

## Backend Impact

**None.** All required handlers already exist and are tested (30 tests passing):

- `tour.create` — create new tour
- `tour.addStep` — add step at index (supports insert)
- `tour.deleteStep` — remove step by index
- `tour.getSteps` — read tour for editing
- `tour.getFileAtRef` — read file at recorded commit

The only unused handler is `tour.finalize` — intentionally skipped per design decision.

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| `tour.addStep` WS fails mid-recording | Low | Previous steps already saved; retry on reconnect; UI shows error |
| User taps line number accidentally (Step+ ON) | Low | Full-screen overlay with Cancel; easy to dismiss |
| Reference point stale after app restart | None | localStorage persists; but steps are saved regardless |
| Workspace switch during editing | None | Auto-clear reference point; no data loss |
