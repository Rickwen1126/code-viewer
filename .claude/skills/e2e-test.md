---
name: e2e-test
description: Run E2E test checklist against code-viewer using Playwright with iPhone viewport (390x844). Starts dev mode if not running, then executes the full 8-test checklist.
---

# /e2e-test — E2E Test Checklist

Run the full E2E checklist against code-viewer using Playwright (iPhone viewport 390x844).

## Prerequisites

Ensure dev mode is running. If ports 4800/4801 are not listening or extension is not connected, invoke `/codeview-dev` first, then return here.

## E2E Checklist

Run Playwright tests against `http://localhost:4801` with iPhone viewport (390x844). Each test corresponds to one checklist item:

| # | Test | How to Verify |
|---|------|---------------|
| 1 | Select workspace -> file tree loads | Navigate to workspace, verify file/directory structure renders |
| 2 | Open file -> syntax highlight + line numbers | Click a file, verify language label present and line numbers are sequential |
| 3 | Back to file tree -> expand state preserved | Navigate back, verify previously expanded directories stay expanded |
| 4 | Search functionality | Enter keyword in search, verify results appear and are correct |
| 5 | Recent files | Focus search input, verify recently opened files appear |
| 6 | Git -> branch + changed files | Switch to Git tab, verify branch name and staged/unstaged file groups |
| 7 | Git -> commit history expand | Click a commit, verify file list appears, click file, verify diff renders |
| 8 | Workspace switch -> data isolation | Switch to a different workspace, verify files/branch/commits are independent |

## Execution

1. **Check if Playwright is installed**:
   ```bash
   npx playwright --version
   ```
   If not installed: `npx playwright install chromium`

2. **Run existing Playwright test files** (if they exist):
   ```bash
   cd /Users/rickwen/code/code-viewer && npx playwright test tests/e2e/
   ```

3. **If no test files exist or tests need updating**, use Playwright MCP to manually verify each checklist item:
   - Navigate to `http://localhost:4801`
   - Set viewport to 390x844 (iPhone)
   - Execute each checklist item sequentially
   - Take screenshots for visual verification
   - Report pass/fail for each item

4. **Multi-repo test** (for item #8):
   - Requires at least 2 workspaces connected
   - Switch between them and verify data (files, branch, commits) is fully independent
   - If only 1 workspace connected, skip #8 and note it

## Reporting

After all tests complete, output a summary table:

```
| # | Test | Result | Notes |
|---|------|--------|-------|
| 1 | Workspace -> file tree | PASS | |
| 2 | File -> highlight + lines | PASS | |
| ... | ... | ... | ... |
```

## Important Notes

- ALL tests must use iPhone viewport 390x844 — this is a mobile-first product
- Playwright MCP tools can be used for interactive testing when scripted tests are insufficient
- Screenshots should be taken at key verification points
- If a test fails, capture the screenshot and log the failure reason before continuing to next test
