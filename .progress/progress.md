## 2026-03-28 16:24 — Frontend features + session resilience bug + CodeTour polish + recording design

**Goal**: Implement 4 frontend features, fix reconnect bug, polish CodeTour viewing, design recording UI

**Done**:
- Feature 2: Session resilience — auto-restore last file, persist wrap/scroll/font-size, per-workspace current-file key
- Feature 1: Markdown preview — `marked` lexer + custom React renderer, Raw/Rendered toggle
- Feature 4a: In-file search — search bar, instant highlight, prev/next, match count
- Feature 3: Bookmarks — single-tap line number, gold ★ gutter, header badge, browser list
- Header: two-row layout (filename + metadata/buttons)
- E2E: 8 → 12 items, "run /e2e-test after new features" rule
- CodeTour viewing polish: selection highlight, getFileAtRef, MarkdownRenderer descriptions, line number offset, scrollToLine
- WS reconnect race condition fix: `else if (res.payload.content)` guard
- CodeTour recording UI design completed — plan written to `docs/superpowers/specs/2026-03-28-codetour-recording-plan.md`

**Decisions**:
- Feature 4b (grep) dropped — low ROI for mobile review
- Markdown rendered mode: no line numbers/bookmarks (source ≠ rendered)
- Bookmark: single-tap line number, not long-press
- **CodeTour recording: no recording mode** — just a reference point (tourId + afterIndex). Each step immediately persisted via WS. Frontend owns only the pointer, backend owns the data.
- Step+ toggle in header: OFF = bookmark, ON = add step to tour
- Full-screen overlay for step input
- No preview needed (structured markdown editor)
- Edit step = description only, not file/line
- No reorder (API doesn't support, nice-to-have)

**State**: main branch, commit `c37cd1c`. 196 tests pass. E2E verified.

**Next**:
- [ ] Implement CodeTour recording per plan doc
- [ ] Verify session resilience + bookmark on real iPhone
- [ ] chatpilot integration

**User Notes**:
- Race condition cascade: race → optimistic overwrite → cache poisoning → self-reinforcing loop (note saved)
- Recording 設計核心洞察：每步即存 = backend 隨時有完整資料 = 不需要 recording mode / finalize / crash recovery / offline queue。前端只持有一個 pointer。
