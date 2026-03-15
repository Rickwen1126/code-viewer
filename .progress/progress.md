## 2026-03-12 22:17 — SHIP Phase 3-7 + Vitest, Lab 01 notes complete

**Goal**: SHIP knowledge confirmation for Phase 3-7 implementation + Vitest testing strategy

**Done**:
- Reviewed Lab 01 tour insights (`.worktrees/labs-phase2/.tours/lab-01-protocol.tour`) — user's own insights on type constraints, scoped error codes, config fallback, MethodMap
- Created semantic note: `ob:dev/vscode/Lab01Protocol協議設計與型別約束心智模型@2026-03-03.md` (32 observations, 4 analogical anchor images)
- Created flashcards: `ob:dev/vscode/Flashcards-Lab01Protocol協議設計與型別約束心智模型@2026-03-03.md` (11 cards)
- Switched semantic-note + flashcards skills to **English-only** language rule
- Started Vitest insight-learning: covered #1 (why Vitest exists — shared Vite transform pipeline) and partially #2 (test runner architecture — discovery by naming convention). Stopped at Question 6.
- Completed SHIP: `.ship/SHIP-code-viewer-vitest-testing@20260312.md`
  - 3 [B]locks: Vitest runner architecture, Mocking mechanism, Testing Hono routes
  - 2 [R]isky: React component testing, Async/WebSocket testing
  - 11 [N]ice-to-know items
  - All gaps are [A] type (AI knows, user doesn't) — no spike needed

**Decisions**:
- All note/flashcard content switched to English (skills updated: `semantic-note/SKILL.md`, `flashcards/SKILL.md`)
- User's English learning workflow: notes in English → Socratic review in English → Gemini bridge for expression gaps → log pairs for spaced repetition

**State**: SHIP saved, 3 [B]locks unresolved. Vitest Socratic teaching paused at Knowledge Point #2 (test runner architecture). User confirmed wants to learn ALL 12 knowledge points + R + N items.

**Next**:
- [ ] Resume Vitest insight-learning from Knowledge Point #2 (Question 6: test discovery convention tradeoff)
- [ ] Resolve B1 (runner architecture) → B2 (mocking) → B3 (Hono testing) → R1 → R2
- [ ] After all [B]locks resolved → update SHIP status → start Phase 3 implementation
- [ ] Create hands-on labs for Vitest in `.worktrees/labs-phase2/labs/`

---

## 2026-02-26 16:22 — Phase 1+2 實作完成 + insight-learning 知識盤點

**Goal**: 實作 Foundation feature 的 Phase 1 (Setup) + Phase 2 (Foundational)，並對 Phase 2 架構做 insight-learning

**Done**:
- Phase 1 (T001-T007): monorepo 骨架、4 workspace packages、Docker Compose、pnpm install 驗證通過
- Phase 2 (T008-T019): protocol types、backend (Hono app + config + path-guard + bridge-proxy + WS endpoint)、extension (bridge-client + pending-requests + entry point)、frontend (App shell + Tab Bar + API client + page shells)
- 所有 4 packages type-check + build clean
- Committed: `ef6b646` (docs) + `2f6c67c` (Phase 1+2 code)
- AUDIT Phase 1: 通過（scaffold 層級），3 個 Docker 相關 finding 留給 T045
- insight-learning prompt 修改：移除「語法自動跳過」規則，改為 AI 列出所有知識點由用戶選
- 12 個知識點全部覆蓋（#1-#12），含 5 個動手實驗（path-traversal、Hono middleware、MethodMap、指數退避）
- 實驗在 worktree: `/Users/rickwen/code/code-viewer-experiments` (branch: `experiments/phase2-learning`)

**Decisions**:
- `upgradeWebSocket` 不 export 出 app.ts → 避免 TS2742 type portability error，WS route 定義在 app.ts
- Bridge Proxy 斷線策略：先 reject all pending → 關 WS → 觸發重連（先清舊世界再開新世界）
- Phase 6 fallback 設計：目前用「事前檢查 isConnected()」而非「事後補救 try-catch」，race condition 下會 error

**State**: Phase 1+2 完成，branch `001-foundation`，worktree 還在（待清理）。Phase 3 (US1 檔案樹) 可開始。

**Next**:
- [ ] 清理實驗 worktree
- [ ] Phase 3: US1 — 手機瀏覽專案檔案樹 (T020-T024, T047)
- [ ] Phase 4: US2 — 語法高亮程式碼檢視器 (T025-T030, T048)

---

## 2026-02-20 22:37 — SHIP 語意筆記整理

**Goal**: 將 SHIP 知識確認內容整理為 mcpbm 語意筆記，建立可複習的 anchor

**Done**:
- 整理 SHIP 為語意筆記：`ob` project `dev/vscode/VSCodeExtension心智模型與架構決策@2026-02-20.md`
  - 18 個 observations（architecture, insight, decision, pattern, flow, concern）
  - 5 個 Training Angles
- 3 張 Analogical Anchor 圖（餐廳廚房比喻）：
  1. Extension Host = 隔離廚房（`res/nanobanana/2026-02-20/extension-host-isolated-kitchen.png`）
  2. Provider 查詢鏈 = 點餐路由系統（`res/nanobanana/2026-02-20/provider-order-routing.png`）
  3. Extension 生命週期 = 餐廳一日營運（`res/nanobanana/2026-02-20/extension-lifecycle-restaurant.png`）

**State**: SHIP 知識已整理為可複習筆記。準備進入 spec。

**Next**:
- [ ] 跑 `/speckit.specify` 定第一個功能規格（Phase 1: Foundation）
- [ ] 建立 CLAUDE.md 專案設定

---

## 2026-02-19 23:11 — Constitution 制定 + AI 架構決策

**Goal**: 為 Code Viewer（VSCode mobile remote viewer）建立專案基礎

**Done**:
- 制定 Constitution v1.0.0（`.specify/memory/constitution.md`），7 項核心原則
- 已 commit：`f4aa91b`
- 研究 GitHub Copilot Extension API 可用性

**Decisions**:
- AI 能力不走 code-server Copilot → 原因：headless 認證不可靠、授權灰色地帶、`vscode.lm` 在 code-server 無官方保證
- Q&A 架構確認：Mobile 提問（`#` reference 選檔案+行範圍）→ JSON 存 server → CLI 端（claude code）拉 pending questions 帶 file context 回答 → POST 答案回 server
- 長期可用 Copilot SDK + local CLI agent tool 維持上下文做追問，但屬後續
- code-server 定位：純 LSP / 檔案系統 / Git / diagnostics，不負責 AI

**State**: 專案剛起步，只有 PRD（`vscode-mobile-view-prd.md`）+ Constitution + speckit templates

**Next**:
- [ ] 跑 `/speckit.specify` 定第一個功能規格
- [ ] 建立 CLAUDE.md 專案設定

---

## 2026-02-20 11:40 — Extension 能力實驗（6/6 全過）

**Goal**: 在進入 spec 前，驗證 VSCode Extension API 在 code-server 中的極限

**Done**:
- 建立 `experiments/` 實驗框架：Docker compose（code-server + WS test backend）+ skeleton extension
- 6 項實驗全數通過：
  1. **File System** — `workspace.fs` 完全可用，不 respect `.gitignore`（正合需求）
  2. **Git API** — `vscode.git` Extension API 完整可用（log, diff, branches, status）
  3. **WebSocket 外連** — Extension 可主動連向外部 WS server（47ms round-trip）
  4. **LSP Proxy** — `execute*Provider` 系列 API 正常運作（references 7個, symbols 7個, implementation 3個）
  5. **Diagnostics** — `getDiagnostics()` + `onDidChangeDiagnostics` 可用
  6. **Workspace 管理** — `updateWorkspaceFolders()` 動態加/移 folder 成功
- 完整實驗報告：`experiments/RESULTS.md`

**Decisions**:
- code-server 4.109.2（VS Code 1.109.2）作為基礎版本
- Extension 依賴必須用 esbuild bundle（vsce 不打包 node_modules）
- `ws` npm package 用於 WebSocket 通訊（不是瀏覽器 WebSocket）
- LSP warmup 約 3-4 秒，需在 Backend 設計中考慮

**已知限制**:
- Extension host 需瀏覽器連線才啟動（非真正 headless）
- LSP 首次查詢需 warmup（~3-4s for TypeScript）
- Workspace single→multi-root 轉換可能觸發 extension restart
- 需用 Open-VSX，非 Microsoft Marketplace

**State**: PRD 架構完全可行已驗證。準備進入 spec 階段。

**Next**:
- [x] ~~跑 `/speckit.specify` 定第一個功能規格（Phase 1: Foundation）~~ → 先做了 SHIP 知識確認
- [ ] 建立 CLAUDE.md 專案設定

---

## 2026-02-20 20:15 — SHIP 知識確認：Extension 心智模型建立

**Goal**: 解除 VSCode Extension 開發的知識盲區，確保能理解而非 vibe coding

**Done**:
- 完成 SHIP 知識確認（`.ship/SHIP-code-viewer-extension-mental-model@20260220.md`）
- 3 個 [B]lock 全部解除：
  1. **B1 Extension Host 架構** — Extension 跑在 server 端獨立 Node.js child process，`"main"` vs `"browser"` 決定跑在哪；需獨立 Backend 因為 Extension Host lifecycle 不可控
  2. **B2 Provider/Command 模式** — `execute*Provider` 是統一窗口轉給語言 extension，語言 extension 透過 LSP 問背後 Language Server（compiler/parser）；warmup = Language Server 建型別圖譜
  3. **B3 Extension 生命週期** — `onStartupFinished` 等所有服務就緒；Extension Host 綁 server session 不綁瀏覽器（spike 驗證：瀏覽器關閉後 4+ 分鐘仍存活）；`deactivate()` 需手動關 WebSocket
- Spike 驗證：Extension Host 在瀏覽器斷開後持續存活（綁 server session）
- 實驗報告整理完成（`experiments/RESULTS.md`）含完整過程 + 踩坑紀錄

**Decisions**:
- Extension Host 瀏覽器斷開後不死 → Backend 不需要頻繁處理 bridge 斷線重連
- Backend 偵測 Extension Host 不在線時，可用 HTTP 戳 code-server 喚醒
- warmup 期間 Backend 回 `{ status: "warming_up" }` 讓前端顯示提示

**State**: 3 個 Block 全解除，SHIP 狀態為「可開工」。準備進入 spec。

**Next**:
- [ ] 跑 `/speckit.specify` 定第一個功能規格（Phase 1: Foundation）
- [ ] 建立 CLAUDE.md 專案設定
