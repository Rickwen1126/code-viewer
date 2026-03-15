# SHIP: Code Viewer Foundation Phase 3-7 + Vitest

tags: [ship, vitest, testing, typescript]

## Relations
- ship_plan_for [[todo-code-viewer-phase3@20260312]]

## 1. Problem Statement

**Problem**: Implement Code Viewer Foundation Phase 3-7 (file tree, syntax highlighting, project selection, fallback, polish) with Vitest test coverage for the three-layer architecture.

**Target**: Developer self-use mobile code browsing tool

**Success Criteria**: Mobile file tree browsing + syntax highlighted code reading + multi-project switching + offline fallback, with Vitest unit/integration tests covering core paths.

## 2. Solution Space

Architecture locked from Phase 1-2. New decisions:

| Decision | Options | Choice | Reason |
|----------|---------|--------|--------|
| Test framework | Vitest vs Jest | Vitest | Project uses Vite; shared transform pipeline avoids dual config |
| E2E testing | Playwright vs Cypress | Playwright | Native mobile viewport support, headless stable |
| Frontend testing | Testing Library vs Enzyme | Testing Library | React 19 recommended, tests behavior not implementation |
| File tree loading | Full load vs Lazy | Lazy (load on expand) | Large projects (node_modules 10K+ files) timeout with full load |
| Syntax highlight runtime | Main thread vs Web Worker | Web Worker | Shiki tokenization CPU-intensive, must not block UI |

**Choice**: All above confirmed in spec/plan.

## 3. 技術決策清單

| Decision Point | Choice | Reason | Alternative Considered |
|----------------|--------|--------|----------------------|
| Test runner | Vitest | Same Vite transform, ESM native | Jest (CJS-native, separate transform) |
| Backend route testing | `app.request()` | Test Hono routes without real HTTP server | supertest (extra dep, Jest-era) |
| VSCode API mocking | `vi.mock('vscode')` | Replace entire vscode module in tests | Manual DI (over-engineering) |
| React component testing | @testing-library/react | Tests user-visible behavior | Direct DOM assertions (fragile) |

## 4. 橫向掃描

[待討論] — Not done yet.

## 5. 知識風險標記

### [B]lock (不理解，會影響方向)

- [ ] **B1: Vitest test runner architecture** — how it discovers, runs, and isolates tests
  - Why: Never used a test framework. Can't structure test files or debug failures without understanding execution model.
  - Exit Questions:
    1. When Vitest encounters a `.test.ts` file, what 3 steps happen before your assertion code runs? [A]
    2. Each test FILE gets its own module registry, but tests WITHIN a file share state. What failure does isolation prevent? What failure does shared state create? [A]
  - 狀態：未解除 (partially covered — got through "why Vitest exists" + "test discovery")

- [ ] **B2: Mocking mechanism — vi.mock() / vi.fn() / vi.spyOn()**
  - Why: Three-layer architecture means every layer depends on externals (Extension→VSCode API, Backend→bridge-proxy, Frontend→API client). Tests must replace these with controlled doubles.
  - Exit Questions:
    1. When you write `vi.mock('vscode')`, what happens to `import * as vscode from 'vscode'` in the file under test? At what point does replacement happen? [A]
    2. `vi.fn()` vs `vi.spyOn()` vs `vi.mock()` — when would you use each in Code Viewer's three layers? [A]
  - 狀態：未解除

- [ ] **B3: Testing Hono routes without a real server**
  - Why: Backend has 4+ route files. Need to test without starting HTTP server or real Extension connection.
  - Exit Questions:
    1. How does `app.request('/api/projects')` work internally — does it go through the network? [A]
    2. The files.ts route depends on bridge-proxy. How do you replace the real bridge-proxy with a test double? [A]
  - 狀態：未解除

### [R]isky (大概懂但不確定)

- **R1: React component testing with @testing-library/react**
  - Exit Questions:
    1. "Test behavior, not implementation" — clicking a folder to expand: assert React state change or DOM change? Why? [A]

- **R2: Testing async patterns (WebSocket reconnection, pending requests)**
  - Exit Questions:
    1. Testing exponential backoff: why can't you just `await` and need `vi.useFakeTimers()`? [A]

### Spike Plan

All B-type questions are [A] (AI knows, user doesn't). No spike needed. Resolve through Socratic dialog + hands-on labs.

- **Session 1**: B1 (Vitest architecture) — continue from Knowledge Points #2-#12
- **Session 2**: B2 + B3 (Mocking + Hono testing) — builds on B1

### [N]ice-to-know (不影響方向) — User wants to learn ALL

- Vitest coverage (v8 vs istanbul)
- Snapshot testing mechanism
- `test.concurrent` execution model
- In-source testing (`if (import.meta.vitest)`)
- Playwright mobile E2E setup (Phase 7)
- `@tanstack/react-virtual` internals
- Shiki Web Worker setup
- `beforeAll/beforeEach/afterAll/afterEach` lifecycle
- Mock reset/restore (`clearMocks` vs `resetMocks` vs `restoreMocks`)
- Fake timers (`vi.useFakeTimers()`)
- Watch mode (HMR-based re-run)

## 6. 開工決策

- [ ] 所有 [B]lock 已解除
- [x] [B]lock ≤ 3 個 (3 items)
- [x] Problem Statement 清晰
- [x] Solution Space 有比較過
- [x] 技術決策都有根據

**狀態**: 待補 — 3 個 Vitest/Testing [B]lock 未解除。User wants full coverage (B + R + N).
