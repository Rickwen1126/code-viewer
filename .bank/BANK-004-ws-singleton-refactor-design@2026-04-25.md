# BANK: ws-client singleton 重構設計

tags: [bank, websocket, state-machine, epoch, transport-session, design-pattern]

## Relations
- follows [[SHIP-ws-client-singleton-refactor@2026-04-25]]
- extends [[BANK-003-safari-zombie-ws@2026-04-22]]

## 做了什麼

完成 ws-client singleton 重構的 SHIP 知識確認。三個 Block 全部解除：State Machine 非法轉換 ignore、Epoch-based stale event rejection、Transport/Session 分層邊界。未寫實作 code — 這輪是純知識確認 + 設計收斂。

附帶釐清前因：Safari 卡死的主因是 cross-port WebSocket 阻擋（已透過 Vite proxy 修復），不是 race condition。重構的動機修正為結構性技術債改善。

## 學到什麼

1. 下次遇到 **多個 async writer 共享 mutable state 且已經加了兩輪以上 guard** 要 **停止加 guard，改用 state machine 收口**，因為 guard 是「各自判斷」（4 個交警各舉旗），state machine 是「唯一 source of truth」（紅綠燈）。guard 的正確性取決於每一個使用點都寫對，state machine 的正確性由轉換表保證。

2. 下次遇到 **需要辨認「這個 async callback 屬於哪一代資源」** 要 **用遞增 epoch 集中在單一入口檢查，不要在每個 handler 各自做 reference 比對**，因為 reference 比對需要每個地方都記得 capture + 比對（散落防護），epoch 集中在 `setConnection` 一處檢查（集中防護）。散落防護的正確性取決於開發者不犯錯；集中防護的正確性取決於入口本身寫對。

3. 下次遇到 **cleanup handler 要決定清什麼** 要 **先問「這個資源的生命週期綁在哪個層」**，因為 transport 斷線是 transport 事件，不該連 session 一起清。Session 生命週期綁業務意圖（使用者關閉 workspace），不綁 transport 事件（socket onclose）。intentional close → 清 session；transport retry → session 不動。

4. 下次遇到 **debug 某個現象一直抓不到根因，已經 patch 了多輪** 要 **退一步確認根因假設是否正確**，因為這次三輪 patch 都假設是 race condition，實際根因是 Safari cross-port 阻擋。正確的根因讓修復變成一行 proxy config，而不是結構性重構。（重構仍然有價值，但動機從「修 bug」變成「改善結構」，優先級完全不同。）

## 心智模型

### State Machine 取代 Flag Soup
**機制**：當系統有 N 個散落的 boolean flag 控制行為時（如 `shouldReconnect`、`probing`、`reconnectTimer !== null`），狀態空間是 2^N。State machine 把合法狀態收斂到 K 個（K << 2^N），非法轉換直接 ignore。所有決策看同一個 source of truth，不是各自讀各自的 flag。
**故障模式**：flag soup 的每個 flag 組合都可能是一個未測試的 code path。加新 flag 時，舊 guard 不會自動覆蓋新 flag 的交互。表現為「修 A 功能冒出 B 的 bug」。
**防護**：(1) 畫出合法狀態轉換圖 (2) 實作轉換表（`transitions[currentState][event] → nextState | ignore`）(3) 所有行為從 state 推導，不從 flag 組合推導。
**適用場景**：任何有 3 個以上 boolean flag 控制流程的 service class。WebSocket 連線管理、async job runner、UI wizard flow、auth state。

### Epoch = 集中式世代辨識
**機制**：每次建立新資源（socket、connection、worker）遞增一個數字。所有 async callback 帶著建立時的 epoch。檢查集中在資源的唯一寫入入口（`setConnection`），不在每個 callback 各自做。不符的事件被丟棄 + log。
**故障模式**：不用 epoch 而用 reference 比對 → 每個 handler 都要記得 capture local reference。忘了 capture、capture 位置錯、或透過 `this.ref` 間接操作繞過比對 → 靜默失敗。表現為「某個 handler 沒有 stale guard」的間歇性 bug。
**防護**：(1) epoch 是 singleton 上的單一遞增數字 (2) 只有 `setConnection` 會改 epoch (3) 對外不暴露 epoch，只暴露「可用/不可用」(4) epoch mismatch 時 log 完整資訊（舊 epoch、新 epoch、事件類型）供 debug。
**適用場景**：任何「資源會被替換，但舊資源的 async callback 可能延遲到達」的場景。WebSocket reconnect、DB connection pool rotation、worker restart、React StrictMode double-mount。

### Transport / Session 分層（生命週期綁定原則）
**機制**：Transport 管通道生死（open/close/reconnect），Session 管業務狀態（pending requests、subscriptions、cache、auth）。兩者的生命週期**綁定在不同的業務意圖**上 — transport 綁「有沒有連線」，session 綁「使用者有沒有在用」。
**故障模式**：混在一起 → transport 的 `onclose`（可能只是暫時斷線）清掉了 session 的 pending requests / cache → 500ms 後新 socket 建好，但 pending request 已被 reject、cache 已被清、使用者看到 error → 使用者手動重試，重建本來不需要重建的狀態。
**防護**：(1) `onclose` 只清 transport 資源（socket ref、reconnect timer、event handlers）(2) Session 狀態只在 intentional close（使用者離開 workspace）時清 (3) transport retry 期間 session 持續存在，等新 socket 建好後繼續用。
**適用場景**：任何 long-lived connection 的管理。WebSocket、gRPC stream、SSE、MQTT、database connection pool。Socket.io 的 Manager/Socket 分層、Apollo Client 的 WebSocketLink/SubscriptionClient 就是這個 pattern。

## Runtime Findings

| 症狀 | 根因 | 為什麼 review 沒抓到 | 怎麼更早發現 |
|------|------|---------------------|-------------|
| Safari 背景恢復後 WS 永遠卡 CONNECTING | Safari 阻擋跨 port WebSocket（`:4801` 頁面打 `:4800` WS） | 三輪 debug 都假設是 race condition，沒質疑「為什麼只有 Safari」這個最基本的線索 | 第一輪就在 Safari Web Inspector 的 Network tab 看 WS handshake 有沒有送出；或改成同 port 測試排除 cross-port 因素 |
| iOS Simulator 無法重現實機 bug | Simulator Safari 版本/行為與實機不同；CoreSimulatorService 權限問題 | 自動化工具（Codex）無法拿到 Web Inspector console | 優先用實機 + Safari Web Inspector，Simulator 作為補充 |

## 下次改進

**做對的（保持）：**
- 用紅綠燈 vs 交警的類比建立 state machine 心智模型，跨領域可用
- 從 BANK-003 的「收口」概念自然延伸到「怎麼收口」（state machine + epoch + 分層），知識鏈有連續性
- 在 SHIP 過程中主動修正根因假設（cross-port 才是主因），調整了重構的優先級定位

**做錯的（下次改）：**
- 三輪 patch 都沒退一步質疑根因假設 → 下次連續 patch 兩輪仍未解決時，強制做一次「根因假設是否正確」的檢查
- iOS Simulator spike 花了時間但因為工具限制沒拿到有效數據 → 下次優先用實機 + Web Inspector，Simulator 作為補充而非首選

## 累積項目追蹤

| 觸發器 | 來源 | 本次驗證 |
|--------|------|----------|
| Ownership 決定解法層級 | BANK-003 | ✅ 延伸：ownership 足夠 → state machine + epoch + 分層，而不是 guard |
| Cleanup handler 管轄範圍 | BANK-003 | ✅ 延伸：Transport/Session 分層是管轄範圍原則的具體實作 pattern |
| Singleton mutable reference 收口 | BANK-003 | ✅ 延伸：收口方法 = `setConnection` + epoch 檢查 + state machine 轉換 |
| Signal ≠ Settled Truth | AUDIT-race-conditions | ✅ cross-port 阻擋的症狀（readyState=0, 無事件）看起來像 race condition 但不是 |
| State machine 取代 flag soup | **本次新增** | 跨專案通用 pattern |
| Epoch 集中式世代辨識 | **本次新增** | 跨專案通用 pattern |
| Transport/Session 分層 | **本次新增**（BANK-003 提過概念，本次具體化） | 跨專案通用 pattern |
| 連續 patch 未解 → 質疑根因假設 | **本次新增** | debug 流程 pattern |

## 累積統計
本專案已完成 3 輪迭代（BANK-002 + BANK-003 + BANK-004）
