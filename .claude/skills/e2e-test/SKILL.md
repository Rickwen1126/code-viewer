---
name: e2e-test
description: "Run E2E test checklist against code-viewer using Playwright MCP with iPhone viewport (390x844). Ensures dev mode is running first. Triggers on: /e2e-test"
---

# /e2e-test — E2E Test Checklist

Run full E2E checklist against code-viewer (iPhone viewport 390x844).

## Prerequisites

Check ports 4800 + 4801 are listening and extension connected. If not, invoke `/codeview-dev` first.

## Pass Criteria — Every Test Item MUST

A test item is PASS only when ALL of the following are met:

1. **UI verification**: Take a screenshot at the verification point. Visually confirm the expected state in the screenshot — not just snapshot text.
2. **Data verification**: Confirm the backend state actually changed via an independent check:
   - For file writes: read the file or call a separate API to verify
   - For state changes: navigate away and back, or reload, to confirm persistence
   - For WS operations: check the response type is `.result` not `.error`
3. **Round-trip verification**: After a mutation (create/edit/delete), re-fetch the data from a different entry point (e.g., navigate to list page, re-enter detail page) and confirm the change is reflected.
4. **Error path verification** (where applicable): If the feature has error states, trigger at least one and confirm the UI shows an appropriate error message.

**What counts as FAIL:**
- UI shows expected elements but data didn't persist (e.g., edit overlay closes but content unchanged on reload)
- Operation silently fails (no error shown, no data change)
- Crash or error boundary triggered
- Behaviour differs between Playwright and real device (note as CONDITIONAL PASS with explanation)

**What to do on FAIL:**
- Take screenshot of failure state
- Log the exact error or unexpected behaviour
- Continue to next test item (don't stop)
- Include failure details in report

## Checklist

Use Playwright MCP to verify each item against `http://localhost:4801` at 390x844 viewport.

### Core Features

| # | Test | Steps | Data Verification |
|---|------|-------|-------------------|
| 1 | File tree | Files tab → directories + files render | Expand a directory → files listed match actual repo |
| 2 | Open file | Click a file → code viewer | Language label correct, line numbers sequential from 1, code content matches actual file |
| 3 | Expand state | Expand dirs → open file → go back to Files tab | Previously expanded dirs still expanded |
| 4 | File search | Type keyword in search box | Results match files containing the keyword; click result → opens correct file |
| 5 | Recent files | Focus search → recent files section | Shows files opened earlier in session |
| 6 | Git tab | Navigate to Git tab | Branch name correct, changed files listed with M/A/D status |
| 7 | Git commit history | Click commit → file list → click file | Diff renders with +/- lines, file path in header matches |
| 8 | Workspace switch | Switch to different workspace (requires 2+) | Files/branch/commits reflect new workspace, not stale data from previous. **SKIP if only 1 workspace — note in report.** |
| 9 | Markdown preview | Open .md file | Default: rendered view with headings/lists/code blocks. Toggle Raw → shows source with line numbers. Toggle back → rendered again. |
| 10 | In-file search | Tap search icon → type query | Match count shown (e.g. "3/15"), highlights visible in screenshot, arrows navigate between matches |
| 11 | Session resilience | Navigate to `/` (root URL) | Auto-redirects to last viewed file — NOT to /workspaces or blank page |
| 12 | Bookmarks | Tap line number in gutter (Step+ must be OFF) | Toast "Bookmarked line N" appears. Re-open file → bookmarked line has star. **Requires tap on line number element; skip if Playwright can't trigger — note in report.** |

### CodeTour Recording Features

| # | Test | Steps | Data Verification |
|---|------|-------|-------------------|
| 13 | New Tour: create | Tours tab → + New Tour → type title → Create | Navigate to Files tab automatically. Go back to Tours tab → new tour in list with "0 steps". **Read the .tours/ directory via file tree to confirm .tour file exists.** |
| 14 | New Tour: cancel | Tours tab → + New Tour → type title → Cancel | Input disappears, no tour created. Tours list unchanged. |
| 15 | New Tour: empty title | Tours tab → + New Tour → leave title empty | Create button is disabled. |
| 16 | Step+ visibility | After creating tour (reference point exists) → open a file | Step+ button visible in header. |
| 17 | Step+ toggle | Tap Step+ to toggle OFF (grey) → tap line number | Should bookmark (not open add-step overlay). Toggle back ON → tap line number → opens add-step overlay. |
| 18 | Add Step: Screen 1 | Step+ ON → tap line number N | Overlay opens. Tour name in header. File name shown. Start line = N pre-filled. End line = N. |
| 19 | Add Step: Screen 2 | Screen 1 → set end line → Next | Section editor with title + content inputs. |
| 20 | Add Step: save | Fill title + content → Save | Overlay closes. Toast "Step added to {tour}". **Go to Tours tab → tour now shows "1 step". Open tour detail → step has correct file, line range, description.** |
| 21 | Add Step: cancel | Open overlay → Cancel (on either screen) | Overlay closes. No step added. Tour step count unchanged. |
| 22 | Add Step: multiple sections | Screen 2 → + Add Section → fill both → Save | Description contains both sections as `## title\ncontent`. Verify in tour detail. |
| 23 | Add Step: consecutive | Add step 1 → add step 2 (different file/line) | Both steps exist in correct order in tour detail. afterIndex incremented correctly. |
| 24 | Tour detail: view | Tours tab → tap tour with steps | Step content rendered: title (h2), description, file:line, code snippet with correct line numbers. |
| 25 | Tour detail: navigation | Prev/Next buttons, step dots | Navigate between steps. Step counter updates (e.g. "2 / 3"). Prev disabled on first, Next disabled on last. |
| 26 | Tour detail: Edit step | Tap Edit on a step | Edit overlay opens with existing title + content pre-filled in section editor. Modify content → Save. **Verify: step description actually changed. Navigate away and back to tour detail → updated content persists.** |
| 27 | Tour detail: Delete step | Tap Delete on a step | Confirm dialog appears. Tap "Yes, delete". **Verify: step removed. Step count decremented. Navigate away and back → step still gone.** |
| 28 | Tour detail: Delete last step | Delete the only remaining step | Redirects to /tours. Tour shows "0 steps". Open tour → empty state UI ("This tour has no steps yet"). |
| 29 | Tour detail: + Add step after | Tap "+ Add step after" on a step | Navigates to Files tab. Step+ visible. Add a step → verify it appears AFTER the reference step in tour detail. |
| 30 | Empty tour | Open tour with 0 steps | Shows "This tour has no steps yet" + "+ Add Steps" button. No crash. |
| 31 | Empty tour: add steps | Tap "+ Add Steps" on empty tour | Navigates to Files. Step+ visible. Add step → go back to tour → now has 1 step. |
| 32 | Tours list: editing indicator | While reference point is active → go to Tours tab | The tour being edited has blue left border + "Adding steps..." label + Done button. Other tours have no indicator. |
| 33 | Tours list: Done | Tap Done on the editing tour | Editing indicator disappears. Go to Files → Step+ button gone. |
| 34 | Reference point: tab switch | While editing → switch to Git tab → back to Files | Step+ still visible. Reference point preserved. |
| 35 | Reference point: workspace switch | While editing → switch workspace | Reference point cleared. Step+ gone. No crash. |
| 36 | Reference point: app lifecycle | While on tour detail → navigate to `/` | Auto-redirects to last file. Reference point preserved (check localStorage `code-viewer:tour-edit`). |

### Resilience & Edge Cases

| # | Test | Steps | Data Verification |
|---|------|-------|-------------------|
| 37 | Tour detail reconnect | Open tour detail → disconnect WS (kill backend briefly) → reconnect | Page recovers. Tour data reloads. No crash. |
| 38 | Edit on existing tour | Open a pre-existing tour (not created via UI, no `status: 'recording'`) → Edit a step | Edit succeeds. Backend accepts addStep/deleteStep without recording status. **This was a real bug — verify explicitly.** |
| 39 | Add step to existing tour | Set reference point on pre-existing tour (via detail page "+ Add step after") → add step | Step added successfully. Tour file updated. |
| 40 | WS error handling | Trigger a WS error (e.g., invalid tourId) | Error message shown to user, not silently swallowed. |

## Execution Protocol

1. Set viewport to 390x844
2. Navigate to `http://localhost:4801`
3. Execute each item sequentially
4. At EVERY verification point:
   a. Take a screenshot (`browser_take_screenshot`)
   b. Take a snapshot (`browser_snapshot`) for data checks
   c. For mutations: perform the independent data verification described in the "Data Verification" column
5. On failure: capture screenshot, log exact failure reason, continue to next item

## Report

Output two tables:

**Summary:**
| # | Test | Result | Notes |
|---|------|--------|-------|

**Failures (if any):**
| # | Test | Expected | Actual | Screenshot |
|---|------|----------|--------|------------|
