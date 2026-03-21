# E2E Success Criteria — Manual Validation Checklist

Run all 3 services per QUICKSTART.md, then validate on mobile device.

## SC-001: App → File Tree < 5s

- [ ] Open app URL on phone
- [ ] Select workspace from list
- [ ] File tree renders within 5 seconds
- Measure: time from tap "Select" to first file node visible

## SC-002: File → Highlighted Code < 2s

- [ ] Tap any `.ts` file in file tree
- [ ] Syntax-highlighted code with line numbers appears within 2 seconds
- Measure: time from tap file to code fully rendered

## SC-003: Go to Definition < 3s

- [ ] Long-press on a function/type name
- [ ] Tap "Go to Definition" in action sheet
- [ ] Target file/line loads within 3 seconds
- Measure: time from action sheet tap to destination visible

## SC-004: Chat Streaming First Token < 5s

- [ ] Open Chat tab
- [ ] Send a message to Copilot
- [ ] First streaming token appears within 5 seconds
- Measure: time from send to first `chat.stream.chunk` rendered

## SC-005: Touch Response < 200ms

- [ ] Tap on code → hover tooltip appears responsively
- [ ] Tab bar switching is instant
- [ ] Scroll is smooth (no jank on files < 500 lines)
- Measure: perceived latency, no visible delay on UI interactions

## SC-006: Offline Cached File < 1s

- [ ] Open a file (caches to IndexedDB)
- [ ] Disconnect backend / go offline
- [ ] Navigate back to same file
- [ ] Cached content appears within 1 second
- Measure: time from tap to cached content displayed

## SC-007: Complete Code Review Flow

- [ ] Open app → select workspace
- [ ] Browse file tree → open a file
- [ ] Read syntax-highlighted code with line numbers
- [ ] Tap to see hover type info
- [ ] Long-press → Go to Definition
- [ ] Long-press → Find References
- [ ] Check Git tab → see changed files + diff
- [ ] Open Chat → ask Copilot a question
- [ ] Complete flow WITHOUT returning to desktop

## Playwright Automation (future)

When ready to automate, setup:

```bash
pnpm add -D @playwright/test
npx playwright install chromium
```

Tests should use `page.goto()` against the running frontend, with WS mocking for Backend/Extension responses. Key assertions:
- `page.waitForSelector('[data-testid="file-tree"]', { timeout: 5000 })` for SC-001
- `page.waitForSelector('pre code', { timeout: 2000 })` for SC-002
- Performance marks via `page.evaluate(() => performance.mark(...))` for timing
