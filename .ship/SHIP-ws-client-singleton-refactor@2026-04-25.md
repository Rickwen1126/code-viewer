# SHIP: ws-client singleton 重構

tags: [ship, websocket, state-machine, refactor, frontend]

## 0. AI Context（AI 補課，非使用者判斷）

- **Codebase 現狀**：`ws-client.ts` 398 行，class-based singleton。6 個方法讀寫 `this.ws`：`openSocket`、`onclose` handler、`forceReconnect`、`disconnect`、`connect`、`probeConnection`（間接）。6 個散落的控制 flag：`shouldReconnect`、`probing`、`reconnectTimer`、`connectTimer`、`consecutiveFailures`、`wsConnectTimeouts`。
- **前因導正**：Safari 卡死的主因已確認為 cross-port WebSocket 阻擋（Safari 背景恢復後靜默拒絕跨 port WS），已透過 Vite proxy 修復（`commit a6eb00a`）。三輪 patch 期間一直以為是 race condition，實際上 race condition 是次要現象。
- **本次動機**：cross-port 修好後 Safari 主要症狀消失，但多 async writer 競爭 `this.ws` 的結構性風險仍在（`problem.md` 時序 A/B/C 仍可能發生）。這是結構性技術債改善 + 學習價值，不是緊急修復。
- **盲點提醒**：
  - `pendingRequests` drain 是 all-or-nothing，transport 斷線時不該連 session 狀態一起清
  - `probeConnection` 用同一個 `request()` → `pendingRequests` map，probe timeout 和正常 request timeout 會互相影響
  - `connect()` idempotent guard 只檢查 state 不檢查 URL 變更
- **Survey 建議**：不需要。方向已收斂。

## 1. Problem Statement

**問題**：`ws-client.ts` 的 `this.ws` 有多個 async writer 競爭，transport 和 session 邏輯混在同一層，導致 transport 事件（onclose）越級清掉 session 狀態（pending requests、cache）。三輪 patch 用 guard 修，每次修一個冒兩個。

**對象**：Code Viewer 前端（主要是 iPhone Safari / PWA 使用者）

**成功條件**：
1. `this.ws` 只有一個寫入入口（`setConnection`）
2. 狀態轉換有明確定義，非法轉換被 ignore
3. 舊 socket 事件無法影響新 socket 的狀態（epoch 保護）
4. Transport 事件不越級清 session 狀態
5. 現有 289 tests 全過

## 2. Solution Space

| 做法 | 優勢 | 風險/代價 |
|------|------|-----------|
| A. 繼續加 guard | 最小改動 | 已加三輪，控制面碎片化只會更嚴重 |
| B. 單一控制面重構（setConnection + state machine + epoch + 分層） | 從結構上消除 race condition 產生的條件 | 一次性改動範圍較大 |
| C. 換 third-party library | 社群驗證 | 自定義 protocol 不適用；Safari 特有行為不處理 |

**選擇**：B
**原因**：問題是結構性的，patch 只會越補越多洞。自定義 protocol 讓 third-party 不適用。

## 3. 技術決策清單

| 決策點 | 選擇 | 原因 | 備選 |
|--------|------|------|------|
| `this.ws` 寫入 | 單一方法 `setConnection(ws)` | handler 清理、state 通知集中一處 | 散落的 `this.ws = ...`（現狀） |
| 狀態模型 | State machine：`disconnected → connecting → connected → reconnecting` | 取代 6 個散落 flag；非法轉換直接 ignore | Flag-based 控制（現狀） |
| 舊事件防護 | Socket epoch（每次 openSocket 遞增） | 集中在 setConnection 檢查，不依賴每個 handler 各自 capture reference | `this.ws !== socket` 比對（現狀，不一致） |
| 分層 | Transport / Session 分離 | onclose 只清 transport，不動 session；session 生命週期綁 workspace 而非 socket | 混在一起（現狀） |
| pendingRequests | Session 層管理，transport 斷線不 drain | retry 場景 pending request 可等重連後重送 | all-or-nothing drain（現狀） |
| 錯誤邊界 | Singleton 內部 log epoch mismatch；對外只暴露連線不可用 | 消費者不需要知道 epoch 細節，只處理「不可用」 | — |

## 4. 橫向掃描

未做正式掃描。設計參考：
- TCP state machine 合法轉換模型
- Socket.io 的 Manager（transport）/ Socket（session）分層
- survey-conclusion 的「單一控制面」概念

## 5. 知識風險標記

### [B]lock — 全部已解除

- [x] **B1: State Machine 非法轉換 ignore**
  - 解什麼問題：多個 async writer 各自用 flag 判斷是否動作 → 改成統一狀態轉換表，非法轉換直接丟棄，從結構上限制可能的路徑
  - 用錯會怎樣：散落的 guard 永遠有漏洞 — 每次修一個路徑，另一個路徑的 guard 就不夠用（如 `problem.md` 時序 A/B/C）
  - 為什麼選這做法：guard 是「各自判斷」，state machine 是「唯一 source of truth」。紅綠燈 vs 4 個交警
  - Exit Questions:
    1. guard-based 防禦為什麼無法根治多 writer 競爭？ [A] → ✅ 各自判斷會互相覆蓋
    2. state machine 的表達力不如 guard 靈活，這個代價怎麼評估？ [A] → ✅ transport 層不需要「往左往右」的靈活度，四個狀態夠用
  - 狀態：✅ 已解除

- [x] **B2: Epoch-based stale event rejection**
  - 解什麼問題：舊 socket 的延遲事件（onclose）影響新 socket 的狀態，reference 比對散落且不一致
  - 用錯會怎樣：reference 比對忘記 capture、capture 錯位置、或透過 `this.ws` 間接操作繞過比對 — 靜默失敗
  - 為什麼選這做法：epoch 集中在 `setConnection` 檢查，不依賴每個 handler 自己做防護。同時是可觀測的信任邊界 — 內部 log mismatch，對外只暴露「不可用」
  - Exit Questions:
    1. epoch 跟 reference 比對的結構性差別是什麼？ [A] → ✅ epoch 集中檢查 vs reference 要每個地方各自記得做
    2. epoch 不符時為什麼是丟棄 + log 而不是嘗試修復？ [A] → ✅ 責任在 singleton 不在消費者；消費者只處理「不可用」
  - 狀態：✅ 已解除

- [x] **B3: Transport / Session 分層邊界**
  - 解什麼問題：transport 事件（onclose）越級清掉 session 狀態（pending requests、cache），導致 retry 場景資料消失
  - 用錯會怎樣：斷線重連只是 transport 事件，但目前 `drainPendingRequests` 把所有等待中的 request reject 掉 — 500ms 後新 socket 建好了，pending request 已經被清了
  - 為什麼選這做法：session 生命週期綁 workspace（業務意圖）而非 socket（transport 事件）。intentional close → 清 session；transport retry → session 不動
  - Exit Questions:
    1. onclose 發生時，哪些該清哪些不該清？ [A] → ✅ transport 資源（socket ref、timer）該清；session 狀態（pending、cache、workspace）不該動
    2. 為什麼不讓 session 管 transport？ [A] → ✅ session 是狀態容器不是控制器，層級倒置
  - 狀態：✅ 已解除

### [R]isky

- Safari `new WebSocket()` stuck in CONNECTING 的 WebKit 內部機制 — 已知會發生（實機驗證），但不確定所有 iOS 版本是否一致。已有 5s connect timeout 兜底。
  - Exit Questions:
    1. 如果未來 Safari 修了這個行為，connect timeout 會造成什麼影響？ [A] — timeout 不會觸發，退化為 dead code，無害

### [N]ice-to-know

- WebSocket protocol-level ping/pong（RFC 6455）
- BFCache 與 `pageshow.persisted` 細節
- `visibilitychange` 跨瀏覽器差異

## 6. 開工決策

- [x] 所有 [B]lock 已解除
- [x] [B]lock ≤ 3 個（3 個，全部解除）
- [x] Problem Statement 清晰
- [x] Solution Space 有比較過
- [x] 技術決策都有根據

**狀態**：可開工（優先級：結構性改善，非緊急）
