---
name: e2e-test
description: "Run E2E test checklist against code-viewer using Playwright MCP with iPhone viewport (390x844). Ensures dev mode is running first. Triggers on: /e2e-test"
---

# /e2e-test — E2E Test Checklist

Run full E2E checklist against code-viewer (iPhone viewport 390x844).

## Prerequisites

Check ports 4800 + 4801 are listening and extension connected. If not, invoke `/codeview-dev` first.

## Checklist

Use Playwright MCP to verify each item against `http://localhost:4801` at 390x844 viewport:

| # | Test | Verify |
|---|------|--------|
| 1 | Select workspace -> file tree | Files/directories render correctly |
| 2 | Open file -> highlight + line numbers | Language label present, line numbers sequential |
| 3 | Back to file tree -> expand state | Previously expanded directories stay open |
| 4 | Search | Enter keyword, results correct |
| 5 | Recent files | Focus search, recently opened files appear |
| 6 | Git tab | Branch name + staged/unstaged groups |
| 7 | Git commit history | Click commit -> file list -> click file -> diff renders |
| 8 | Workspace switch | Different repo's files/branch/commits are independent |
| 9 | Markdown preview | Open .md file → rendered view with headings/lists/code blocks, Raw/Rendered toggle works |
| 10 | In-file search | Tap 🔍 → search bar appears, type query → match count + highlights, ▲/▼ navigate |
| 11 | Session resilience | Navigate to `/` → auto-redirects to last viewed file (not grey screen/workspaces) |
| 12 | Bookmarks (manual) | Long-press gutter → toast + ★ appears, focus search → bookmarks section shown |

Item #8 requires 2+ connected workspaces. If only 1, skip and note.
Item #12 requires real touch events (long-press 400ms), skip in Playwright and test on phone.

## Execution

1. Navigate to `http://localhost:4801`, set viewport 390x844
2. Execute each item sequentially
3. Take screenshots at key verification points
4. On failure: capture screenshot, log reason, continue to next

## Report

Output summary table with PASS/FAIL per item.
