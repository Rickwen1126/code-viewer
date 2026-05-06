# SHIP: code-viewer ws-client Safari 重連收口

tags: [ship, websocket, safari, frontend, singleton]

## Relations
- ship_plan_for [[todo-ws-singleton-refactor]]

## 0. AI Context（AI 補課，非使用者判斷）
- Codebase 現狀：
  - 已完成 Safari 重連 race 的第一輪修補（`reconnectTimer`、CONNECTING 判斷修正）但未根治。
  - `frontend/src/services/ws-client.ts` 仍存在多處直接修改 `this.ws` 的異步 writer，且 `openSocket` / `onclose` / `forceReconnect` / `disconnect` 競爭明顯。
  - backend 的 `frontend stale detection` 已獨立完成（`onFrontendRemoved` 與 heartbeat），前後端資料流可先不改。
  - 最近一次工作已完成 `FileBrowserSidebar` hooks 順序修正並待 commit。
- 技術脈絡：
  - Safari iOS/PWA 特性（BFCache、頁面暫停/恢復、`visibilitychange` 時序）在不同版本間差異大，行為不是純 spec 可推斷，仍需實機觀察。
- 盲點提醒：
  - 若只加 guard 會再形成「同場多兵」：目前狀態已是「三輪 patch」而非收斂。
  - `Backend ws manager` 雖已穩定，但前端 banner 與 state 顯示仍是使用者可見故障感知，不可忽略。
- Survey 建議：
  - 不需要大範圍外部 survey；建議以 iOS Simulator 實機 log 觀察 + 目標導向 spike 驗證替代文件假設。

## 1. Problem Statement
**問題**：Safari iOS PWA 從背景恢復後，`ws-client` 會卡在 `Reconnecting... (connecting)`，使用者可見連線未穩定，根因可能來自單例 socket 寫入競爭而非單點 bug。  
**對象**：code-viewer 前端使用者與維運者（尤其在 iOS Safari/PWA 使用情境）  
**成功條件**：背景恢復後，連線進入「可穩定恢復」而非停在 connecting；重連行為可被唯一寫入點可預測控制，且不產生 orphan socket 或訊息遺失。

## 2. Solution Space
| 做法 | 優勢 | 風險/代價 |
|---|---|---|
| A: 延續逐步 guard 修補 | 改動小、短期快 | 已累積 3 輪 patch，無法保證新時序下不再重現，維護負擔高 |
| B: `this.ws` 單一入口收口 (`setConnection`)，加明確連線 state machine | 根治多 writer race 根因、便於 reasoning 與測試 | 重構範圍中等，需重新定義幾個狀態轉換與 event handling |
| C: 改用成熟 websocket library（含自動 reconnect） | 內建重連策略，開發時間可預估 | 可能衝到 bundle 大小、行為可觀測性、以及既有 handoff 協定與 extension 專用狀態邏輯 |

**選擇**：B（收口到單一入口 + 明確 lifecycle）  
**原因**：現況錯誤不是「少了某個 guard」，而是可控性缺失；不修改架構會把相同類型競態封裝成新 bug。

## 3. 技術決策清單
| 決策點 | 選擇 | 原因 | 備選 |
|---|---|---|---|
| ws 寫入策略 | 引入單一入口 `setConnection(ws: WebSocket \| null)` 並集中清理舊 handler | 降低 async writer 競態，避免 late onclose 改寫新 socket | 保留 direct assignment，但加鎖旗標（目前已明顯不足） |
| 連線狀態模型 | 先維持現有 state 與 listener 架構，逐步導入 `disconnected/connecting/connected/reconnecting` | 先鎖定行為邏輯，避免一次大改壓垮測試面 | 一次性 full state-machine 重寫（風險高） |
| Transport 與 session 責任 | 明確分層：transport 只管 socket 生命周期，session 只管資料請求路由 | 提升故障定位速度，避免 onclose 清到不該清的 session |
| 調試策略 | 以 iOS Simulator + `code-viewer:debug=true` 逐步驗證五個問題 | 停止猜測，讓時序資料先行 |

## 4. 橫向掃描
| 參考專案 | 值得借鏡的做法 | 要避開的坑 |
|---|---|---|
| 無（本輪無新增外部專案掃描） | 待討論：是否需比對市面上已驗證的 WS transport 封裝器行為 | 未進行，避免過早引用可能不符現有 extension lifecycle |

## 5. 知識風險標記

### [B]lock（不理解，會影響方向）
- [ ] WebSocket 事件時序在 Safari iOS + BFCache 的實際行為（`visibilitychange`、`pageshow`、`onclose`/`onopen` 的跨事件關係）
  - 解什麼問題：這決定為什麼 `openSocket` 會被誤複製與覆蓋，否則重構狀態切換可能「看起來對」卻仍 race。
  - 用錯會怎樣：設計再精緻也會被瀏覽器邏輯打穿，造成偶發卡在 connecting 的假復原。
  - 為什麼選這做法：目前已知問題帶有平台特性，必須先以資料而非直覺決定 state 轉換條件。
  - Exit Questions:
    1. 當頁面從背景回到前景時，Safari 觸發 `pageshow` 的時序與 `visibilitychange` 是否可預期？ [B]
    2. `onclose` 事件可能晚於新 socket 開啟，這種「晚到事件」該如何判斷它是否屬於舊連線？[B]
  - 狀態：未解除
- [ ] 為什麼 `setConnection` 入口在 singleton 內能完整切斷舊連線副作用而不影響 session 生命期
  - 解什麼問題：連線層和業務層混寫是導致 side effect 的主因；能否拆責任影響 bug 邊界。
  - 用錯會怎樣：要不會清掉有價值 pending request，要不會清掉 stale handlers，兩者都會造成「沒錯誤但無效工作」。
  - 為什麼選這做法：`onclose` 本身不是只叫 `setConnection(null)`，要定義清潔度。
  - Exit Questions:
    1. 在關閉 socket 時，哪些資源必須同步清，哪些可以交給 session 層？ [B]
    2. 何時需要在 transport 層保留短暫狀態（例如 reconnect buffer），何時該回到 disconnected？ [A]
  - 狀態：未解除
- [ ] 狀態機在「CONNECTING」與「OPEN 但失活」兩種非理想情況的差異化處理
  - 解什麼問題：目前過去 patch 曾把 CONNECTING 當異常 kill，這會在 Safari 上放大抖動。
  - 用錯會怎樣：要麼過度重開 socket，要麼錯過可用連線，造成顯示與實際不一致。
  - 為什麼選這做法：穩定狀態邏輯是把連線視覺回報正確化的核心。
  - Exit Questions:
    1. `readyState` 是 indicator 還是 symptom？在不可靠網路下如何判定需要重連？ [A]
    2. 哪些 event 可以視為「正在連線但不可重建」而不是立即重建？ [A]
  - 狀態：未解除

### [R]isky（大概懂但不確定）
- `WebSocket` 觀測與清理函式（例如 `onmessage`/`onerror` handler 換線時釋放策略）可能有邊界行為差異，需在實作對照 spike 補齊。
- 「transport/session」抽離對 `workspace selection` 的順序要求是否會造成第一幀 state 偏差，需明確規劃。
- 目前未量化的風險：即使收口成功，banner 狀態是否仍可被既有 UI 狀態更新一致，需一併驗證。

### Spike 計畫（B 類 Exit Questions 分群）
- Spike 1: iOS 事件時序追蹤 → 覆蓋 B1/B2
  - 做什麼：按 `docs/ws-client-singleton-refactor/problem.md` 的 5 步在 simulator 重現並保存時間戳 log
  - 預計時間：30 min
- Spike 2: 單一入口收口最小實作與比較 → 覆蓋 B3
  - 做什麼：以最小代碼加 `setConnection`，保留既有 state 變更，但移除除法重入路徑；對比重現率
  - 預計時間：30 min

### [N]ice-to-know（不影響方向）
- VSCode extension 的連線啟用方式（`codeViewer.enabled`, `codeViewer.backendUrl`）已知且不影響 ws-client 重構邏輯核心。
- Backend stale detection 的 5 分鐘 sweep 已完成且可先保留，不作本輪關注。

## 6. 開工決策
- [ ] 所有 [B]lock 已解除
- [ ] [B]lock ≤ 3 個
- [ ] Problem Statement 清晰
- [ ] Solution Space 有比較過可行替代
- [ ] 技術決策有資料與機制理由，不是用「先前修補風格」為唯一依據

**狀態**：待補
