# Semantic Location History Contract

**Created**: 2026-04-12  
**Last Updated**: 2026-04-13  
**Status**: Proposed  
**Scope**: Frontend navigation contract first; Phase 1 focuses on browser-history-correct semantic navigation. This spec supersedes `docs/git-tour-origin-context/spec.md` as the canonical navigation design.

---

## Contract: Browser History Is the Primary Navigation Truth

This is the governing contract for the feature.

1. **User-perceived navigation must participate in browser history.**
   If the user experiences an action as "I went somewhere else to inspect code", then browser Back/Forward must treat it as navigation, even if it stays inside the same React route component.

2. **The history unit is a semantic location, not just a page component.**
   Examples of semantic locations:
   - `tour abc step 3`
   - `git diff path/to/file at commit abc123`
   - `src/foo.ts line 120`
   - `src/foo.ts line 420`
   - `src/bar.ts line 30`

3. **Canonical semantic location lives in the URL.**
   Durable location state such as file path, line, range, tour step, and diff identity belongs in the URL so it survives refresh, direct entry, and external links.

4. **Not every UI state belongs in the URL.**
   Only semantic location is canonical URL state. Transient UI state such as popovers, toasts, search panel visibility, and Step+ toggles must stay out of the URL.

5. **The router stays primary.**
   This feature does not replace React Router with a custom navigation system. It adds the missing semantic granularity on top of browser history and route URLs.

6. **Named return actions are unwind operations, not new forward navigations.**
   `Back to Tour` and `Back to Diff` must return to an existing history anchor. They must not push a fresh page entry that creates loops or "fake returns".

7. **We preserve behavior, not old implementation details.**
   Existing localStorage keys, route-state fields, and cache layers are not contractual by themselves. They should be retained only when they are still the best way to preserve or improve user-visible behavior.

8. **New canonical behavior may replace older mechanisms.**
   If the new URL-backed semantic location contract can cover the old UX more directly, more predictably, and with fewer hidden dependencies, the new contract wins. Old mechanisms may be downgraded to fallback or removed once behavior parity is confirmed.

9. **Migration decisions must be judged by user-visible outcomes.**
   The question is not "did we keep the old key/path/state object" but "did we preserve or improve the useful behavior the user relied on".

---

## Why This Spec Exists

The app currently has partial browser-like behavior, but it is inconsistent:

- ordinary route changes often work with Back/Forward already
- same-file code jumps do not naturally participate in history
- cross-file code jumps only partially preserve intent
- Git/Tour -> Code Viewer return behavior is still ad hoc
- location truth is split across URL, `location.state`, and localStorage

The result is a familiar but brittle UX:

- some navigations feel correct "by accident" because the browser sees route changes
- some navigations fail because semantic location was never recorded as history
- `Back to Tour` / `Back to Diff` becomes hard to define cleanly if the app keeps mixing push-style navigation and temporary in-memory context

This spec defines one navigation contract that can cover:

- code jump history
- Git/Tour return context
- future deep links from agent workflows

---

## Problem

### Current failure modes

1. **Same-file semantic jumps are invisible to history.**
   Example: `foo.ts line 120 -> foo.ts line 420` via Go to Definition does not create a real history entry today.

2. **Cross-file code jumps preserve destination better than source.**
   Example: `foo.ts line 120 -> bar.ts line 30` may create a route change, but the app still lacks a true semantic source location contract.

3. **Tour/Git return context is under-specified.**
   The older Git/Tour return-context spec introduced the right problem statement, but it still framed the solution as a mostly local viewer concern rather than a browser-history contract.

4. **Tour step is not yet canonical URL state.**
   It is currently driven mainly by internal state and localStorage progress, which is not enough for precise direct entry or return anchors.

5. **Location truth is split across too many mechanisms.**
   `scrollToLine` in route state, Tour step in localStorage, file scroll restore in localStorage, and plain route URLs all coexist. This is workable as fallback, but not as canonical navigation truth.

---

## Goals

1. Make browser Back/Forward feel correct for semantic code navigation.
2. Make same-file and cross-file code jumps behave consistently.
3. Make Git diff -> Code Viewer -> return and Tour -> Code Viewer -> return follow the same history model.
4. Make semantic locations URL-addressable so refresh and direct entry restore the current location.
5. Preserve browser-like UX instead of replacing it with a custom app-only navigation model.
6. Preserve high-value UX behaviors even when their old implementation is replaced.

## Non-goals

1. Replacing the whole router or inventing a full custom navigation stack.
2. URL-encoding every transient UI state.
3. Solving media preview in this round. Media preview will build on this location contract later.
4. Removing all existing localStorage fallback in Phase 1.
5. Freezing current storage keys or route-state shapes as permanent public API.

---

## Migration Contract: Preserve Behavior, Not Legacy Code

This migration must optimize for user-visible behavior, not legacy implementation preservation.

### Rules

1. If the new semantic URL contract can preserve a useful behavior more directly, use the new contract.
2. Keep old localStorage / route-state / cache mechanisms only when they still provide value as:
   - fallback restore
   - preference storage
   - performance cache
   - temporary bridge during migration
3. Remove or downgrade old mechanisms when:
   - they are no longer the canonical truth
   - they duplicate newer URL-backed behavior
   - they create hidden coupling or inconsistent restore behavior
4. Do not remove an old mechanism until the behavior it enabled has an equal or better replacement.

### "Good UX" evaluation rubric

An existing behavior counts as worth preserving when it is user-visible and provides at least one of these benefits:

- reduces repeated locating work
  - example: reopening a recent file lands near the last place the user was reading
- preserves user orientation
  - example: Back returns to the location the user mentally considers "where I just was"
- improves restart / reconnect continuity
  - example: the app reopens the last workspace/file instead of dropping the user at a generic start page
- preserves reading preferences
  - example: wrap mode, markdown mode, font size
- improves perceived responsiveness without confusing truth
  - example: cache-first file content while fresh content loads in background

An existing behavior does **not** automatically deserve preservation just because it exists. It should be replaced or removed when it is:

- only an implementation accident with no clear user value
- inconsistent with browser/history intuition
- redundant once semantic URL truth exists
- a source of hidden state that makes direct entry or refresh less predictable

---

## Semantic Location Model

### Durable location state

These fields define the current semantic location and belong in the URL:

- `kind`
  - `file`
  - `tour`
  - `git-diff`
- `path`
- `line`
- `endLine`
- `tourId`
- `step`
- `commit`
- `status`

Line numbers in canonical URLs are **1-based** because:

- they match what users see in editors and tour steps
- they are the natural form for copied links and manual inspection
- internal 0-based editor/LSP positions can be converted at the boundary

### Route shapes

The exact route set can evolve, but the contract should be equivalent to:

- File location:
  - `/files/:path?line=120`
  - `/files/:path?line=120&endLine=140`
- Tour location:
  - `/tours/:tourId?step=3`
- Git diff location:
  - `/git/diff/:path?commit=abc123&status=modified`

### External link / resolver shape

For external entry from agent workflows, CLI, or copied links, the system needs a stable workspace resolver layer, for example:

- `/open/file?workspace=<workspaceKey>&path=<path>&line=120`
- `/open/tour?workspace=<workspaceKey>&tourId=<tourId>&step=3`
- `/open/git-diff?workspace=<workspaceKey>&path=<path>&commit=<hash>`

Important:

- `extensionId` is runtime identity and must not be the canonical public workspace identifier.
- `rootPath` is an internal machine-local implementation detail and must not be the canonical public workspace identifier.
- `workspaceKey` is the canonical public identifier for deep links.

### Workspace public identity contract

This contract exists to keep deep links shareable inside the product workflow without leaking absolute local filesystem paths.

#### Public vs internal identity

- `workspaceKey`
  - opaque
  - safe to place in browser URLs, copied links, screenshots, and logs
  - the only workspace identifier allowed in public deep-link URLs
- `rootPath`
  - internal resolver target
  - may appear in admin/debug/control-plane responses
  - must not appear in canonical public deep links
- `extensionId`
  - runtime transport identity
  - never a public link identifier

#### Resolution model

The backend is the authority for resolving public workspace identity.

It must maintain a live key map:

- `workspaceKey -> rootPath`

And, operationally, also the inverse association needed to reuse keys when possible:

- `rootPath -> workspaceKey`

This means:

1. Extension register/connect events provide `rootPath` to backend as internal metadata.
2. Backend resolves or creates the corresponding `workspaceKey`.
3. Backend returns `workspaceKey` in workspace-list / link-generation surfaces used by frontend, CLI, and agents.
4. Resolver routes such as `/open/file` consume `workspaceKey`, not `rootPath`.
5. Frontend uses that `workspaceKey` to bind to the correct live workspace before navigating to the in-app canonical route.

#### Stability requirements

1. The same live workspace should keep the same `workspaceKey` across reconnects whenever practical.
2. A copied link should not churn just because the extension process restarted.
3. The exact generation strategy is implementation-defined, but the public contract is not:
   - persisted local key map
   - deterministic machine-local keyed derivation
   - equivalent approaches
4. Whichever strategy is chosen, it must avoid exposing raw `rootPath` in public URLs.

#### Current branch status

The current branch already ships external deep-link support, but the present `workspace=<rootPath>` form is an **interim implementation**, not the final contract.

The final contract defined by this spec is:

- external URLs use `workspaceKey`
- backend resolves `workspaceKey` to `rootPath`
- `rootPath` stays internal to the control plane

### Ephemeral detour metadata

Some navigation metadata is meaningful only inside the current browser session and should live in `history.state`, not the URL:

- the unwind anchor for `Back to Tour` / `Back to Diff`
- optional anchor delta or anchor location payload
- optional animation or scroll restoration hints

Reason:

- an externally opened file URL should not pretend it came from a Tour or Diff
- the detour affordance is session-local navigation context, not durable document identity

---

## History Operations

There are exactly three semantic navigation operations in this contract.

### 1. `push`

Use `push` when the user leaves the current semantic location to inspect another one.

Examples:

- Go to Definition
- References jump
- Symbol jump if it becomes a true location jump
- Tour step -> Code Viewer
- Git diff -> Code Viewer
- file A -> file B
- file A line 120 -> file A line 420

`push` means:

- create a new URL/history entry
- make Back return to the previous semantic location

### 2. `replace`

Use `replace` when the user is still inside the same flow and the app should update the current location without polluting browser history.

Examples:

- Tour Next / Prev
- any future intra-flow pager-like movement where the user expectation is "I am still in this session"

`replace` means:

- update the current history entry's URL/state
- do not add a new browser history slot

### 3. `unwind`

Use `unwind` for named return affordances such as `Back to Tour` and `Back to Diff`.

`unwind` means:

- return to a previously recorded history anchor
- do not create a fresh forward navigation entry

Primary implementation rule:

- when anchor metadata is available, use `history.go(-n)` / `navigate(-n)` to return to the anchor
- when anchor metadata is unavailable, fall back to `replace(anchorUrl)` rather than `push(anchorUrl)`

Reason:

- `push` would create loops such as `Diff -> Code -> Back to Diff -> browser Back -> Code`
- users expect a named "back to source context" action to exit the detour, not duplicate it

---

## Detour Anchor Contract

This contract defines how `Back to Tour` / `Back to Diff` behaves without becoming awkward.

### Definition

A **detour** begins when the user leaves a source context such as:

- a Tour step
- a Git diff entry

to inspect code in the File Viewer.

The original source entry is the **anchor**.

### Rules

1. Detour entries carry anchor metadata in `history.state`.
2. The anchor entry itself does not show the named return affordance.
3. Entries inside the detour do show the affordance.
4. Clicking the affordance unwinds back to the anchor instead of pushing a new route.
5. If the user later goes Forward back into the detour, the affordance can reappear because those entries still belong to the detour.
6. Nested code jumps inside the detour preserve the **outermost anchor**.

### Example

History:

1. Tour list
2. Tour `abc` step 3
3. `/files/foo.ts?line=120`
4. `/files/bar.ts?line=30`

At entry 4, `Back to Tour` should:

- unwind to entry 2
- not create a new entry 5

After unwinding:

- browser Back should go to entry 1
- browser Forward should re-enter entry 3 and entry 4
- when the user lands again on entry 3 or 4, `Back to Tour` can appear again

This is correct and browser-like.

---

## Per-Surface Rules

### Code Viewer

Code Viewer must treat code jumps as semantic navigation, even when the route component does not change.

Requirements:

1. Same-file jumps must update the URL query, for example `?line=420`, and use `push`.
2. Cross-file jumps must push a new file URL with the target line/range.
3. On mount and on Back/Forward, Code Viewer must restore its visible location from the URL.
4. Existing `location.state.scrollToLine` can remain as compatibility fallback in Phase 1, but the URL must become canonical.

### Tour

Tour step must be URL-addressable but should not spam browser history.

Requirements:

1. Canonical Tour location is `/tours/:tourId?step=N`.
2. Tour Next / Prev uses `replace`, not `push`.
3. `View in Code Viewer` pushes a file URL and attaches Tour detour anchor metadata.
4. If no `step` query is present during migration, existing localStorage progress may be used only as fallback.

### Git

Git diff already maps naturally to a URL-addressable route.

Requirements:

1. Canonical diff location remains `/git/diff/:path?...`.
2. `View Live File` pushes a file URL and attaches Git detour anchor metadata.
3. `Back to Diff` unwinds to the original diff anchor when possible.

### Root tabs and tab switches

This spec does **not** replace current root-tab behavior with a custom per-tab stack system.

Rules:

1. Tab switches continue to behave like ordinary route navigation.
2. Existing browser-like page history should be preserved.
3. The new work only adds semantic granularity where route history is currently too coarse.

Root tabs are therefore **not** the main problem to solve in Phase 1.

---

## What Should Not Be URL State

These should remain transient or preference state:

- search panel visibility
- hover popover state
- toast visibility
- Step+ toggle
- markdown rendered/raw preference
- word wrap preference

These may remain localStorage-backed even after Phase 2:

- view preferences
- bookmark data
- convenience "open the last file when launching the app" behavior

---

## Phase Plan

### Phase 1: Navigation correctness

Ship the semantic navigation contract without trying to simplify every old fallback at the same time.

Includes:

- semantic file URLs with line/range
- Tour step URL with `replace`
- code jump `push`
- Git/Tour detour anchor metadata
- named unwind affordances

Does not require:

- deleting all localStorage fallback
- external link API yet

### Phase 2: State audit and simplification

After Phase 1 is stable, audit which existing state is still acting as accidental location truth.

Candidates to downgrade or remove:

- `scrollToLine` route state as canonical location mechanism
- Tour step localStorage as primary truth
- other location-like transient state that is now superseded by URL

Principle:

- URL becomes location truth
- localStorage falls back to preferences and convenience restore

### Phase 3: External deep-link hardening

Build on the same contract for:

- backend link API
- CLI link generation
- future agent workflow helpers
- public workspace identity that does not leak `rootPath`

Requirements:

- deep links use `workspaceKey`, not `rootPath`
- backend owns the `workspaceKey -> rootPath` resolution map
- frontend resolver routes consume `workspaceKey`
- CLI may accept local `rootPath` as input, but must resolve it to `workspaceKey` before emitting links

This phase hardens the already-started deep-link stack. It does **not** reinvent the resolver flow; it replaces the interim public identifier.

---

## Acceptance Criteria

1. Same-file Go to Definition creates a Back/Forward-restorable history entry.
2. Cross-file Go to Definition also restores the exact previous semantic location.
3. Tour Next / Prev updates the URL but does not create one browser entry per step.
4. Tour -> Code Viewer -> `Back to Tour` unwinds to the original Tour step without creating a history loop.
5. Git diff -> Code Viewer -> `Back to Diff` unwinds to the original diff without creating a history loop.
6. Refreshing a canonical file/tour/diff URL restores the same semantic location.
7. Forward navigation after an unwind can re-enter the detour and show the named return affordance again.
8. External deep links do not expose absolute local workspace paths in canonical public URLs.

---

## Summary

The core decision is now fixed:

- browser history remains the primary navigation truth
- semantic location becomes URL-addressable
- `push`, `replace`, and `unwind` have distinct semantics
- named return actions are session-local detour unwinds, not fake new page visits
- public deep links use opaque `workspaceKey`, while `rootPath` remains internal

This gives the app one consistent model for:

- code jump history
- Git/Tour return context
- future deep links from agent workflows
