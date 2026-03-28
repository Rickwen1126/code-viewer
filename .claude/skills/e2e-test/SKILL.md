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
2. **Data verification via console logs**: After every mutation (create/edit/delete/add step), call `browser_console_messages` to check:
   - WS request was sent (look for `[relay]` or `[ws]` log lines)
   - Response type is `.result` not `.error` (e.g., `tour.addStep.result`, NOT `tour.addStep.error`)
   - No uncaught exceptions or error logs
   - If error logs present → immediate FAIL, log the full error message
3. **Round-trip verification**: After a mutation, navigate away and back (or re-enter from a different entry point) to confirm the change actually persisted — not just optimistic UI.
4. **Error path verification** (where applicable): Trigger a failure scenario and confirm the UI shows an error message to the user (not silent failure).

### Three-layer log verification

Every WS operation passes through three layers. All three must agree for PASS:

```
Frontend (browser console)  →  Backend (terminal stdout)  →  Extension (VS Code Output)
```

**Layer 1 — Frontend console** (Playwright `browser_console_messages` → Read log file):
- WS request sent: look for request type in console
- WS response received: `.result` = success, `.error` = failure
- React errors, uncaught exceptions

**Layer 2 — Backend relay** (read terminal output via Bash `cat` on backend log, or check recent stdout):
- `[relay]` lines: `{type} {msgId} → extension (age: Nms)` = request forwarded
- `[relay]` lines: `{type}.result {msgId} ← extension (round-trip: Nms)` = response routed back
- Missing relay line = message never reached extension

**Layer 3 — Extension handler** (VS Code Developer Tools console or Output channel):
- `[CodeViewer]` lines: handler execution, errors
- Handler errors: `[CodeViewer] {type} error: {message}`

**For Playwright E2E**: Layer 1 (frontend console) is the primary check — always read the log file. Layer 2 (backend) can be checked via Bash if needed for debugging failures. Layer 3 (extension) is hardest to access from Playwright — check indirectly via response type (.result vs .error).

**The key rule**: if frontend console shows `.error` response, the test FAILS regardless of UI state. If frontend console shows `.result` but UI doesn't update, the test also FAILS (frontend bug).

**What counts as FAIL:**
- UI shows expected elements but console has `.error` response (silent failure)
- UI shows expected elements but data didn't persist on round-trip
- Console shows uncaught exception or error boundary
- Operation completes but console shows no WS request was sent
- Crash or error boundary triggered

**What to do on FAIL:**
- Take screenshot of failure state
- Capture console log content (read the log file)
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
| 18 | Add Step: Screen 1 | Step+ ON → tap line number N | Overlay opens. Tour name in header. File name shown. Start line = N pre-filled. End line empty (placeholder = N). |
| 18a | End line: empty → Next | Leave end line empty → Next | Passes validation. Screen 2 shows `file:N` (single line). |
| 18b | End line: invalid → Next | Type end line < start line → Next | Alert shown "End line must be ≥ N". Does NOT proceed to Screen 2. |
| 18c | End line: clear & retype | Clear end line field completely → type new value | Field accepts deletion and re-entry (no stuck value). |
| 18d | End line: Auto button | Tap Auto button | `lsp.documentSymbol.result` in console. End line filled with enclosing symbol's last line. If no symbol found → alert "No enclosing symbol found". |
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
   a. Take a screenshot (`browser_take_screenshot`) — visually confirm
   b. Take a snapshot (`browser_snapshot`) — confirm UI elements
   c. For mutations: call `browser_console_messages` → Read the console log file → check for `.result` (success) or `.error` (failure)
   d. For mutations: navigate away and back to confirm persistence (round-trip)
5. On failure: screenshot + console log content + exact failure reason, continue to next item
6. **NEVER mark PASS based solely on UI snapshot** — console log verification is mandatory for any WS operation

## Report

Output two tables:

**Summary:**
| # | Test | Result | Notes |
|---|------|--------|-------|

**Failures (if any):**
| # | Test | Expected | Actual | Screenshot |
|---|------|----------|--------|------------|
