# Git/Tour -> Code Viewer -> Return Context

**Date**: 2026-03-31
**Status**: Proposed
**Scope**: Frontend routing and UX only. No backend or extension protocol changes required for MVP.

---

## Why this doc exists

The repo currently has two different strands of context:

1. Early exploration in `.progress/codetour-deploy-20260322-0801.md` proposed commit-aware viewing by mutating git state (`stash -> checkout -> restore`).
2. The later approved CodeTour extension design in `docs/superpowers/specs/2026-03-22-codetour-record-edit-design.md` explicitly rejected git mutations and standardized on read-only access via `git show <ref>:<path>`.

This doc does **not** revive git mutations. Instead, it defines the missing frontend navigation contract:

- open the live file from Git diff or Tour detail
- keep a deterministic "return to where I came from" affordance
- support both Git and CodeTour with one shared pattern

---

## Problem

Current behavior is asymmetric:

- CodeTour already supports `View in Code Viewer`, but it is a one-way jump.
- Git diff does not yet offer an equivalent "open original file" action.
- Code Viewer only understands `scrollToLine` in `location.state`; it has no concept of source context.
- The global swipe-back gesture uses `navigate(-1)`, which is fine for stack pop, but not enough to preserve an explicit "return to diff/tour" affordance after deeper file navigation.

As a result, users can inspect code, but they cannot reliably jump back to the exact Git/Tour context they started from.

---

## Goals

1. From a Git diff page, open the live file in Code Viewer and return to the same diff view.
2. From a Tour step, open the live file in Code Viewer and return to the same Tour step.
3. Preserve the return target even if the user navigates to another file from within Code Viewer, for example via Go to Definition.
4. Keep the design read-only with respect to git state. No checkout, stash, restore, or worktree mutation.

## Non-goals

1. No commit switching or worktree mutation for CodeTour viewing.
2. No backend message changes for MVP.
3. No attempt to persist return-context across full app reloads as a durable session feature.
4. No generic multi-origin navigation framework beyond Git diff and CodeTour in this round.

---

## Current behavior snapshot

### CodeTour

- `frontend/src/pages/tours/tour-detail.tsx` navigates to `/files/:path` with `{ scrollToLine }`.
- `specs/002-mobile-viewer/tasks.md` task `T062` defines only the one-way "View in Code Viewer" jump.

### Git

- `frontend/src/pages/git/diff-detail.tsx` only has a back button.
- There is no "open live file" action from diff detail today.

### Code Viewer

- `frontend/src/pages/files/code-viewer.tsx` reads `location.state.scrollToLine`.
- Internal file-to-file navigation also only forwards `scrollToLine`.

---

## User stories

### Story 1: Git diff -> live file -> same diff

While reviewing a changed file in Git diff, the user can open the live file in Code Viewer, inspect the full source, and then explicitly return to the same diff page.

### Story 2: Tour step -> live file -> same step

While reading a CodeTour step, the user can open the file in Code Viewer, inspect the live file, and then explicitly return to the same Tour step.

### Story 3: Preserve return target during deeper navigation

After entering Code Viewer from Git or Tour, if the user jumps to another file from Code Viewer, the explicit return affordance still points back to the original Git/Tour context, not merely the previous file.

### Story 4: Graceful fallback

If Code Viewer is opened directly, or the temporary origin context is unavailable, Code Viewer behaves normally with no extra return affordance.

---

## Proposed design

### 1. Add a shared `originContext` route state

Extend Code Viewer route state from:

```ts
{ scrollToLine?: number }
```

to:

```ts
type CodeViewerRouteState = {
  scrollToLine?: number
  originContext?: ViewerOriginContext
}

type ViewerOriginContext =
  | {
      kind: 'git-diff'
      path: string
      commit?: string
      status?: string
      label: 'Back to Diff'
    }
  | {
      kind: 'tour-step'
      tourId: string
      stepIndex: number
      label: 'Back to Tour'
    }
```

Key point:

- `originContext` is ephemeral navigation state, not canonical document state.
- It belongs in route state, not URL query params.

### 2. Git diff detail gets "View Live File"

Add a button to `frontend/src/pages/git/diff-detail.tsx`:

- label: `View Live File`
- destination: `/files/:path`
- state:

```ts
{
  originContext: {
    kind: 'git-diff',
    path,
    commit,
    status,
    label: 'Back to Diff',
  },
}
```

Notes:

- This opens the working-tree file, not the historical blob shown in diff.
- For added files, this still opens the real file path in Code Viewer.

### 3. Tour detail upgrades its existing jump

Replace the current one-way navigation in `frontend/src/pages/tours/tour-detail.tsx` with:

```ts
{
  scrollToLine: step.line - 1,
  originContext: {
    kind: 'tour-step',
    tourId,
    stepIndex: currentStep,
    label: 'Back to Tour',
  },
}
```

This preserves the exact step index instead of relying only on Tour progress localStorage.

### 4. Code Viewer shows an explicit return affordance

When `originContext` exists, Code Viewer shows a secondary header action:

- `Back to Diff`
- `Back to Tour`

Behavior:

- tap the action -> navigate to the explicit source route
- do not rely on `navigate(-1)` for this action

Routing targets:

- `git-diff` -> `/git/diff/:path` with the original `commit` and `status` query params
- `tour-step` -> `/tours/:tourId` with route state `{ restoreStepIndex: stepIndex }`

This gives users a deterministic exit even after they navigate deeper inside Code Viewer.

### 5. Preserve `originContext` during Code Viewer internal navigation

`frontend/src/pages/files/code-viewer.tsx` currently uses `navigateToFile()` for in-viewer jumps.

Update that helper so it forwards the existing `originContext`:

```ts
navigate(`/files/${encoded}`, {
  state: {
    scrollToLine: line,
    originContext: currentOriginContext,
  },
})
```

This applies to:

- Go to Definition
- References jump
- any future in-viewer file-to-file navigation

Without this, the user loses the explicit return target after the first internal file jump.

### 6. Tour detail accepts a one-shot `restoreStepIndex`

`frontend/src/pages/tours/tour-detail.tsx` should optionally read:

```ts
{ restoreStepIndex?: number }
```

If present:

- use it once on mount
- clamp it to the step range
- then continue normal localStorage progress behavior

This makes the return path deterministic and avoids depending on whichever step was last persisted.

### 7. Keep swipe-back semantics simple

The global left-edge swipe in `frontend/src/app.tsx` should remain `navigate(-1)`.

Reason:

- it matches the browser-like mental model
- users may still want stack-pop behavior inside Code Viewer
- the new explicit header action is the deterministic "return to source context" control

So this feature adds an explicit return action, not a custom swipe override.

---

## UX details

### Code Viewer header

When `originContext` exists:

- show the return action near the existing file-level controls
- use subdued but visible styling, similar to existing secondary buttons
- keep it text-based, not icon-only, to reduce ambiguity

Examples:

- `Back to Diff`
- `Back to Tour`

### Git diff detail

Place `View Live File` in the header area near file metadata so the action is discoverable before the diff content scroll area.

### Tour detail

Keep the existing `View in Code Viewer` wording or rename it to `Open Live File`; either is acceptable, but the return affordance in Code Viewer must make the round trip obvious.

---

## Edge cases

1. Direct entry to `/files/:path`
   - no `originContext`
   - no return action shown

2. User navigates from Tour to Code Viewer, then to another file via Definition
   - `originContext` remains the original Tour step
   - return action still goes to that Tour step

3. User returns to Git diff for a commit-scoped diff
   - the original `commit` query param must be preserved

4. Tour step index becomes invalid after editing/deleting steps
   - clamp to the nearest valid step
   - if the tour no longer exists, show normal "Tour not found"

5. Full page reload while inside Code Viewer
   - losing temporary `originContext` is acceptable for MVP
   - Code Viewer continues to function as a normal file viewer

---

## Implementation touchpoints

### Frontend files to modify

- `frontend/src/pages/git/diff-detail.tsx`
- `frontend/src/pages/tours/tour-detail.tsx`
- `frontend/src/pages/files/code-viewer.tsx`
- `frontend/src/app.tsx` (no behavior change expected, but verify interaction)

### No changes required

- backend
- extension
- shared WS protocol

---

## E2E acceptance criteria

1. From Git diff, tapping `View Live File` opens Code Viewer and shows `Back to Diff`.
2. Tapping `Back to Diff` returns to the same diff route, including `commit` when present.
3. From Tour detail, tapping `View in Code Viewer` opens Code Viewer and shows `Back to Tour`.
4. Tapping `Back to Tour` returns to the same Tour and same step.
5. After entering Code Viewer from Git or Tour, using Go to Definition to open another file still preserves the same return action.
6. Opening Code Viewer directly shows no `Back to Diff` or `Back to Tour` control.

---

## Open questions

1. Should Git diff also restore diff scroll position, or is "same diff route" sufficient for MVP?
2. Should the Tour button copy stay as `View in Code Viewer`, or should Git and Tour use one unified verb such as `Open Live File`?
3. Do we want temporary `originContext` to survive mobile browser reload via `sessionStorage`, or is route-state-only enough for the first iteration?
