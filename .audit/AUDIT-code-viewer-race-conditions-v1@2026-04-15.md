# AUDIT: code-viewer race conditions v1

tags: [audit, code-viewer, react, concurrency, timing]

## Relations
- follows [[SHIP-code-viewer-demand-driven-sync@2026-04-08]]
- follows [[SHIP-code-viewer-deep-link-media@2026-04-02]]
- extends [signal-vs-settled-truth](/Users/rickwen/code/code-viewer/docs/reference/signal-vs-settled-truth.md)

## 產出類型
軟體產品 / engineering learning special

## 通用核心

### A1 Contract
這次特輯要整理的 contract 是：**在 code-viewer 這種 React + WebSocket + resolver + watcher 的系統裡，signal 只能當 invalidation，不能當 settled truth；有順序依賴的流程必須明確等上游 ready。**

SHIP 偏移檢查：**一致**。這跟 `SHIP-code-viewer-demand-driven-sync` 的 demand-driven / signal-vs-settled-truth 原則一致，也跟 deep-link resolver 的 authority-first contract 一致。

### A2 Failure Modes
1. **把 `pageshow` 當成「應該重連」的 authority，而不是 session-restore signal。**
   - 證據：`frontend/src/services/ws-client.ts` 在 `e8d9e04` 前會在所有 `pageshow` 上呼叫 `ensureActiveConnection('pageshow')`
   - 證據：`frontend/src/__tests__/ws-client.test.ts` 新增 `should ignore initial non-persisted pageshow during first load`
   - 證據：Tailscale 檢查時 console 出現 `Zombie connection detected on pageshow — forcing reconnect`
   - → Exit Q: 為什麼 `pageshow` 這個 signal 只有在 BFCache/session restore 時才該介入 transport lifecycle，而不該在第一次正常載入時介入？ [A]

2. **在 transport 尚未 settled 時就啟動 resolver lookup。**
   - 證據：`frontend/src/pages/open/workspace-resolver.tsx`
   - 證據：`tests/e2e/inspect-tailscale-ws.spec.ts` console 先看到 `state: connecting → connected` 前後，曾出現 `⇒ FAILED (not connected) connection.listWorkspaces`
   - 證據：實際使用者畫面是 `Backend did not respond while resolving this link...`
   - → Exit Q: 為什麼 `/open/file` 這種 direct-entry flow 的真正依賴順序不是「mount 後就一起跑」，而是 `transport connected -> authority lookup -> select -> navigate`？ [A]

3. **把 invalidation signal 當成 truth-ready signal，導致 UI 卡在舊 snapshot。**
   - 證據：`.ship/SHIP-code-viewer-demand-driven-sync@2026-04-08.md`
   - 證據：`docs/reference/signal-vs-settled-truth.md`
   - 證據：Git demand-watch 問題的現場描述：filesystem event 先到，但 truth source 是 VS Code Git API `repo.state`
   - → Exit Q: 如果 signal 比 truth source 早到，而 consumer 只 reload 一次，為什麼 UI 會「永遠錯」而不是「只是慢一點」？ [A]

4. **把 runtime identity 誤當 durable identity。**
   - 證據：`workspaceKey` 已被升格成 public identifier，而 `extensionId` 只剩 runtime handle
   - 證據：resolver / selection 的既有 review finding：cached `extensionId` 不能當 durable selector
   - → Exit Q: 為什麼 runtime handle 可以 cache 當 hint，但不能 cache 當 authority？ [A]

5. **把「前端頁面能打開」誤認成「整個 deep-link flow 正常」。**
   - 證據：`4801` 頁面可開，但 `/open/file` 仍可能卡在 resolver；問題在 `listWorkspaces` 而不是 `path`
   - 證據：Tailscale 測試中，`ws://100.112.227.109:4800/ws/frontend` 可以 open，但 resolver 仍可失敗
   - → Exit Q: 為什麼在多段鏈路裡，只驗「頁面可達」或「socket open」都不足以證明整體 flow 正確？ [A]

### A3 Trade-offs
- 替代 A：**事件一來就立刻重連 / reload / resolve**
  - 不選原因：延遲最低，但等於把 signal 語義升格成 authority；對 eventually-consistent 或 multi-phase transport 很脆。
- 替代 B：**所有問題都上 full-blown state machine / orchestration layer**
  - 不選原因：長期可能正確，但對目前 code-viewer 的問題集合來說太重。先用更清楚的 signal contract、ready gate、retry/follow-up 就能修大部分 timing 問題。

### A4 AI 盲點
1. **把「network path 可達」當成根因。** → ❌  
   Tailscale 問題一開始看起來像 IP / route，但實際證據顯示 `ws://.../ws/frontend` 能 open，根因在前端自己的 pageshow reconnect race。
2. **把 `WebSocket.OPEN` 或 socket object 存在，誤當 request/reply pipeline 已 ready。** → ⚠️  
   transport 可 open，不代表 resolver request 已落在正確 sequencing；仍要看 request log 與 reply。
3. **把 direct-entry 問題當成 path/encoding 問題。** → ❌  
   這次 path 根本還沒被用到；失敗點在 workspace authority lookup 之前。

### A5 受眾價值
受眾：自己，以及會寫 React / event-driven frontend / WebSocket app 的工程師。  
拿到後能做：
- 區分 signal / settled truth / durable identity
- 診斷 direct-entry、Safari restore、watcher invalidation 這類 timing bug
- 在 review 時主動找 sequencing contract，而不是只看「有沒有 onopen / catch / retry」

## Code 延伸

### C1 Lifecycle
`frontend/src/services/ws-client.ts` 的 lifecycle 邊界是這次關鍵：
- `connect()` 啟動 transport
- `visibilitychange` / `pageshow` 是外部 signal
- 但只有 restore-like `pageshow` 才應進入 reconnect lifecycle

如果 lifecycle boundary 不清楚，就會出現「第一次正常載入也被當成 zombie restore」。

→ Exit Q: 對 transport lifecycle 來說，哪些 external events 只是 hint，哪些才有資格觸發 restart/reconnect？ [A]

### C2 Error Model
這次 `/open/file` 畫面顯示的 `Backend did not respond...` 在症狀層面有用，但它曾掩蓋真相：當時不是 backend 整體沒回，而是 request 在 frontend 端就因 not-connected sequencing 失敗。

這提醒：
- error copy 要能區分 transport-not-ready
- authority lookup timeout
- no matching workspace

→ Exit Q: 如果錯誤訊息只剩「backend 沒回」，會如何誤導你對 race 問題的定位？ [A]

### C3 Concurrency
這次 concurrency pattern 很典型：
- React mount
- ws connect
- pageshow
- resolver effect
- listWorkspaces request

多個 effect / event 并行存在，但它們不是同等地位。真正需要的是 sequencing，不是「大家都開 async 就好」。

→ Exit Q: 在 React 裡，什麼時候該把問題想成並行 effect，什麼時候該把問題想成有依賴順序的流程？ [A]

### C4 Side Effects
主要 side effects：
- `visibilitychange`
- `pageshow`
- WebSocket open/close
- pending request reject/drain
- filesystem / git watcher invalidation

這些 side effects 共同問題不是「有沒有 cleanup」而已，而是**它們的語義是否被放到正確層次**。

→ Exit Q: 為什麼 side effect 最大的風險常常不是 leak，而是語義被放錯層？ [A]

### C5 Observability
這輪最有價值的觀測點：
1. `[ws] state: disconnected -> connecting -> connected`
2. `[ws] ⇒ FAILED (not connected) connection.listWorkspaces ...`
3. route-level resolver error text

建議長期保留 / 強化：
- `pageshow` log 應區分 `persisted=true`、`nav.type=back_forward`、一般 first-load
- resolver log 應標出目前 `connectionState`、`liveLookupState`
- request failure 應標明「frontend transport not ready」vs「backend timeout」

→ Exit Q: 如果沒有 request-level log，只看 UI 錯誤文字，為什麼很容易把 sequencing bug 誤判成 network bug？ [A]

## [R]isky 追蹤
| SHIP 標記 | 實際結果 | 處理 |
|-----------|----------|------|
| Signal 不等於 settled truth | **已實際踩中**，不只在 Git watcher，也出現在 Safari/pageshow + resolver 流程 | 補上 `pageshow` 只在 restore-like 情況下介入；保留 signal-vs-settled-truth reference |
| Routing signal 不等於 demand signal | **持續成立**，這次 direct-entry 更證明 resolver 不能把 page event 當 authority | 保持 workspace authority / live list / selection contract，不回退到 cache-first authority |
| 只做一輪 reload 即假設足夠 | **已實際踩中**，first-load 被 pageshow 打斷後，resolver 沒有 settle sequencing 就會直接失敗 | 先修 pageshow gate；後續若再擴張，應優先補明確的 ready gate 而不是更多 signal |

## 累積項目檢查
- 之前的觸發器：**Signal ≠ Settled Truth**
  - 這次情況：有用上，但仍在新場景（Safari restore / direct-entry）再踩一次，代表這個 pattern 需要升級成通用 review checklist，而不是只記在 Git watcher 案例裡。
- 之前的觸發器：**runtime identity ≠ durable identity**
  - 這次情況：沒有再犯成主 bug，但它仍是 resolver/selection 的背景風險，值得繼續保留。

## 學習收穫
| Exit Question | Gap Type | 用戶回答摘要 | 狀態 |
|---------------|----------|-------------|------|
| 為什麼這類流程應依賴完成的狀態，而不是只靠條件觸發就並行開始處理？ | A | 用戶已明確指出：有依賴時應靠流程中的完成狀態，不該只靠 signal 並行展開 | ✅ |
| `pageshow` 這種 signal 為什麼不能直接當 reconnect authority？ | A | 已透過這次 root cause 查明：first-load 與 restore 是不同語義 | ✅ |
| React 裡什麼時候要把問題看成 sequencing 而不是 effect 並行？ | A | 已建立方向，但仍值得後續再做複習 note | 🟡 |

## 判定
**結果**：通過

**待補項目**：
- 把這次 pageshow / direct-entry sequencing 問題正式併入長期 reference，不只留在 git watcher 的 signal-vs-settled-truth 案例
- 後續若再碰類似問題，優先檢查「signal 是否被誤當 authority」與「resolver/request 是否在 ready 前啟動」
