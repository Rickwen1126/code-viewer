# AUDIT: 002-mobile-viewer v1

tags: [audit, mobile, websocket, react, vscode-extension]

## Relations
- follows [[SHIP-002-mobile-viewer@2026-03-15]]

## 產出類型
軟體產品

## 通用核心

### A1 Contract
**一句話**：手機上透過 WS relay 瀏覽 Desktop VS Code 的檔案、LSP、Git、Copilot，觸控優化呈現。

SHIP 偏移檢查：**一致**。6 個 User Story 全部實作，架構完全符合 SHIP 選擇的「Desktop Extension → Backend relay → Mobile PWA」方案。沒有偏移。

### A2 Failure Modes

1. **Extension 斷線後 Frontend 操作全部 30s timeout** → 證據：code 定位 `backend/src/ws/relay.ts:55` timeout 機制 + `frontend/src/hooks/use-workspace.tsx` disconnect handler（已修為 useRef）。但 `pendingRequests` 在 WS close 時不會主動 drain → Frontend 使用者要等每個 in-flight request 逐一 timeout。
   → Exit Q: 當 Backend 偵測到 Extension 斷線時，它知道哪些 Frontend request 還在等這個 Extension 的回覆嗎？如果知道，可以怎麼主動通知它們？ [A]

2. **大檔案（1000+ 行）手機渲染卡頓** → 證據：Known Issues 明確記錄，react-shiki 整塊渲染，無虛擬化。`frontend/src/components/code-block.tsx` 直接把整個 `code` string 丟給 ShikiHighlighter。
   → 已標記為 known issue，Phase 9 T068 做壓測確認閾值。不是 bug，是有意的 MVP trade-off。

3. **Copilot provider 全部回空值** → 證據：`extension/src/providers/copilot-provider.ts:106` `handleChatListSessions` 回 `{ sessions: [] }`、`handleReviewListPendingEdits` 回 `{ edits: [] }`。Chat send 用 `vscode.lm` API 能發新訊息，但既有 session 歷史讀不到。
   → Exit Q: `handleChatListSessions` 回空 list — 使用者在 Desktop 已經有 10 個 Copilot Chat session，為什麼 Extension 拿不到？VS Code 的 Chat session 資料存在哪裡，API 有暴露嗎？ [B]

4. **heartbeat 在 `for...of` 遍歷 Map 時 `delete` entry** → 證據：`backend/src/ws/manager.ts:42` 在迭代 `this.extensions` 的 loop 裡呼叫 `this.extensions.delete(id)`。
   → Exit Q: 在 JavaScript 裡，`for (const [id, entry] of map)` 遍歷時 `map.delete(id)` 是安全的嗎？跟其他語言（如 Java）的行為一樣嗎？ [A]

5. **Frontend IndexedDB cache 沒有容量限制** → 證據：`frontend/src/services/cache.ts` 只有 file-content 的 24h TTL，其他 store（file-tree、chat-sessions、git-status）無限累積。長期使用，切換多個 workspace，cache 只增不減。
   → 低優先，手機 IndexedDB 上限通常 >100MB，短期內不會是問題。

### A3 Trade-offs

- **替代 A：Backend 解析 payload 做業務邏輯（full backend）**
  → 不選原因：Backend 要追每個 VS Code API 的變更，8 個 domain 都要寫解析邏輯。SHIP 明確選擇 relay 模式，實作一致。

- **替代 B：用 Socket.IO 取代自建 WS message protocol**
  → 不選原因：Socket.IO 加 ~40KB bundle + fallback transport 我們不需要。自建 WsMessage 格式 + Correlation ID 更簡潔。SHIP 技術決策一致。

### A4 AI 盲點

1. **react-shiki 的 import 方式** → ⚠️ 需驗證
   - `frontend/src/components/code-block.tsx` import `ShikiHighlighter` from `react-shiki`。Code review agent 提到「default export vs named export」需確認。react-shiki 版本更新可能改 export 方式。
   - 驗證方式：`pnpm --filter @code-viewer/frontend dev` 實際開 browser 確認渲染。

2. **Git Extension API 的型別全部是 `any`** → ⚠️ 需驗證
   - `extension/src/providers/git-provider.ts` 的 `repo.state.workingTreeChanges.map((change: any) => ...)` — Git Extension API 沒有官方 TypeScript 型別。`change.status` 是 number enum，映射邏輯 `mapGitStatus` 是根據推測寫的。
   - 驗證方式：在 VS Code 裡 `console.log(repo.state.workingTreeChanges[0])` 確認實際欄位。

3. **`vscode.lm.selectChatModels({ family: 'gpt-4o' })` 的 family 字串** → ⚠️ 需驗證
   - `copilot-provider.ts:171` hardcode `'gpt-4o'` 作為 family 選擇。VS Code Copilot 更新後 family 名稱可能改變。有 fallback（`selectChatModels()` 不帶 filter），但 primary path 可能空轉。
   - 驗證方式：在 VS Code Extension 環境中 `console.log(await vscode.lm.selectChatModels())` 看可用模型。

### A5 受眾價值
**受眾**：Rick（自用），通勤時 review code 的開發者。
**拿到後能做**：手機上選 workspace → 看檔案樹 → 語法高亮讀 code → tap 看型別 → Go to Definition → 看 Git diff → 跟 Copilot 對話。不用回電腦就能完成一次 code review。
**是否解決 SHIP 問題**：✅ 核心功能完整。Copilot Chat 能發新訊息但讀不到既有 session 歷史（A2-3），這是已知的 MVP 限制。

---

## Code 延伸

### C1 Lifecycle

**Entry points**：
- Backend：`backend/src/index.ts` → `serve()` + `injectWebSocket()` + `manager.startHeartbeat()`
- Extension：`extension/src/extension.ts:190` → `activate()` + `deactivate()`
- Frontend：`frontend/src/main.tsx` → `wsClient.connect()` + React render

**Idempotent 問題**：
- `manager.startHeartbeat()` 有 guard（`if (this.heartbeatInterval !== null) return`）✅
- `wsClient.connect()` 沒有 guard — 連續呼叫兩次會建立兩條 WS 連線，`this.ws` 被覆蓋，舊連線洩漏。

**Cleanup 對稱**：
- Extension: `activate` 推入 `context.subscriptions`，`deactivate` 呼叫 `wsClient.disconnect()` ✅
- Backend: `startHeartbeat` ↔ `stopHeartbeat` 對稱，但 `stopHeartbeat` 從未被呼叫（沒有 graceful shutdown）
- Frontend: `wsClient` 是 singleton，沒有 dispose 機制

→ Exit Q: Backend process 被 SIGTERM 時，connected 的 Extension 和 Frontend 會經歷什麼？WS 連線怎麼被清理？ [A]

### C2 Error Model

**錯誤傳播路徑**：
```
Provider throws → .catch(console.error) → Frontend 永遠收不到回覆 → 30s TIMEOUT
```

**被吞的錯誤**：
- `extension/src/extension.ts:42-44` 所有 provider handler 的 `.catch` 只 log，不回 error response
- `backend/src/ws/manager.ts:49` `entry.ws.raw?.ping?.()` 的 catch 完全吞掉
- `frontend/src/services/ws-client.ts` `handleMessage` 的 JSON.parse catch（如果 Backend 送非 JSON）

**使用者看到什麼**：大多數情況是 loading → 30 秒 → 「timeout」。沒有 provider 層級的 error 反饋。

→ Exit Q: 如果 `handleFileTree` 裡 `readDirectoryRecursive` 拋了 exception，這個 error 的傳播路徑是什麼？Frontend 使用者會經歷什麼？有沒有辦法讓使用者在 2 秒內就知道「這個操作失敗了」而不是等 30 秒？ [A]

### C3 Concurrency

**共享狀態**：
- `backend/src/ws/manager.ts`: `extensions` Map + `frontends` Map — 被 heartbeat interval 和 WS handlers 同時存取
- `backend/src/ws/relay.ts`: `pendingRequests` Map — 被 timeout callback 和 message handler 同時存取

**競態風險**：
- Heartbeat `setInterval` 在 `for...of` 遍歷 Map 時 delete entry（A2-4 已提到）— JS 單線程所以安全，但不是顯而易見的
- `relayExtensionResponseToFrontend` 裡 `clearTimeout` + `delete` — 如果 timeout callback 已在 event loop 排隊但尚未執行呢？

→ Exit Q: Node.js 是單線程的，但 `setTimeout` callback 和 `onMessage` handler 真的不可能「同時」執行嗎？什麼情況下它們的執行順序會不如預期？ [A]

### C4 Side Effects

**I/O 操作**：
- WS send/receive（Backend 所有模組、Extension WS client、Frontend WS client）
- 檔案系統讀取（Extension file-provider、tour-provider）
- VS Code API 呼叫（Extension 所有 providers）
- IndexedDB 讀寫（Frontend cache service）

**listener/timer 盤點**：
| 資源 | 建立位置 | 釋放位置 | 對稱？ |
|------|---------|---------|--------|
| heartbeat setInterval | manager.startHeartbeat | manager.stopHeartbeat | ⚠️ stopHeartbeat 從未呼叫 |
| FileSystemWatcher | file-provider:startFileWatchers | context.subscriptions | ✅ |
| Git state.onDidChange | git-provider:startGitWatchers | context.subscriptions | ✅ |
| Frontend WS onStateChange listeners | use-websocket.ts | useSyncExternalStore cleanup | ✅ |
| Frontend subscribe listeners | 各 page useEffect | useEffect cleanup | ✅ |
| longPressTimer setTimeout | code-viewer.tsx | useEffect cleanup（已修） | ✅ |
| pending request setTimeout | relay.ts / ws-client.ts | clearTimeout on response | ✅（但 WS close 時 frontend 端 不 drain）|

**Singleton**：
- `backend/src/ws/manager.ts`: `export const manager`
- `backend/src/cache/session.ts`: `export const cache`
- `frontend/src/services/ws-client.ts`: `export const wsClient`

→ Exit Q: `manager.stopHeartbeat()` 存在但從未被呼叫。如果 Backend 跑在 Docker 裡被 `docker stop`（SIGTERM），heartbeat interval 會阻止 Node.js process 正常退出嗎？ [A]

### C5 Observability

**目前的觀測能力**：只有 `console.log`。沒有結構化 log、沒有 metrics、沒有 tracing。

**出事時能定位到哪個階段？**：
- Backend 有 extension/frontend connect/disconnect log ✅
- Backend relay timeout 有 log ✅
- Extension provider errors 有 log ✅
- 但看不到：message latency、queue depth、cache hit rate

**建議 3 個 log/metric**：
1. **relay round-trip time** — `backend/src/ws/relay.ts` 在 `pendingRequests.set` 記 `startTime`，response 回來時 log `type + duration`。超過 3 秒的標記 WARN
2. **WS connection count** — `manager.ts` 定期 log `extensions.size + frontends.size`，配合 heartbeat interval
3. **Frontend error rate** — `ws-client.ts` 追蹤 request reject 次數 vs total requests，斷線時的 error burst 可以區分「網路問題」vs「Extension crash」

**Correlation ID 可行性**：已經有了 — `WsMessage.id` 就是 correlation ID。只要在 Backend relay 的 log 裡都印出 `msg.id`，就能從 Frontend request → Backend relay → Extension handler → response 全程追蹤。

→ Exit Q: 如果使用者回報「手機上點檔案很久才出來」，你現在怎麼診斷是 Frontend WS latency、Backend relay delay、還是 Extension API 慢？加什麼最小的 instrumentation 就能定位？ [A]

---

## [R]isky 追蹤

| SHIP 標記 | 實際結果 | 處理 |
|-----------|----------|------|
| R1 Shiki engine system | ⚠️ 未實際驗證 | code-block.tsx 用 react-shiki，需在真機上確認語言動態載入 |
| R2 React 19.2 Activity | ❌ 未使用 | 實作時未用 Activity，tab 切換會 unmount。Known trade-off。 |
| R3 PWA 離線模型 | ✅ 已安全通過 | IndexedDB cache 實作完成，離線 fallback 在 file-browser + code-viewer + git 都有 |
| R4 React Router v7 nested routes | ✅ 已安全通過 | app.tsx 用 nested routes，tab layout 正常 |
| R5 觸控手勢衝突 | ✅ 已安全通過 | swipe-back 限左邊緣 20px + delta 100px，需真機確認但邏輯合理 |
| R6-R13 基礎技術 | ✅ 全部安全通過 | pnpm monorepo、Extension 開發、WS、Hono、Vite、IndexedDB、PWA、CSS viewport 全部正常運作 |

---

## 累積項目檢查

首次 AUDIT，無先前 BANK 記錄可對照。

---

## 學習收穫

| Exit Question | Gap Type | 用戶回答摘要 | 狀態 |
|---------------|----------|-------------|------|
| A2-1: Extension 斷線時主動通知 pending requests | A | — | 待回答 |
| A2-3: Chat session 歷史為何拿不到 | B | — | 待回答 |
| A2-4: JS Map for...of 時 delete 是否安全 | A | — | 待回答 |
| C1: Backend SIGTERM 時 WS 清理 | A | — | 待回答 |
| C2: Provider exception 的傳播路徑 | A | — | 待回答 |
| C3: Node.js 單線程與 setTimeout 執行順序 | A | — | 待回答 |
| C4: stopHeartbeat 未呼叫與 process 退出 | A | — | 待回答 |
| C5: 診斷「點檔案很慢」的 instrumentation | A | — | 待回答 |

---

## 判定

**結果**：需修正（minor）

**待修項目**（都不影響核心功能，但影響生產品質）：
1. Backend graceful shutdown — 加 SIGTERM handler，呼叫 `stopHeartbeat()` + close all WS
2. Frontend `wsClient.connect()` 加 idempotent guard（避免重複連線）
3. Provider error 回傳 — `.catch` 裡除了 log 也要 `sendResponse(createMessage('xxx.error', ...))`
4. Frontend `pendingRequests` drain on WS close（code review suggestion #5）
5. Copilot provider 的 `chat.listSessions` / review handlers 目前全是 stub — 標記為 Phase 2 功能

**不阻擋進入 BANK**：核心架構正確、security fixes 已做、tests 覆蓋關鍵路徑。以上 5 點是 polish 級別。
