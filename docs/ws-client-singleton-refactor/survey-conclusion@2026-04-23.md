# WS-Client 重連 Strategy Survey 結論（Desktop Safari/iOS）

Date: 2026-04-23
Goal: 確認「是否應全面集中到 Singleton 控制」並收斂可持續的修補策略

## 結論（先行）

我們在這個案例裡遇到的「修一補一、越補越大洞」不是單一 bug，而是控制面分散造成的結構性風險：
- 事件來源有多條（`visibilitychange`、`pageshow`、`reconnect timer`、manual `disconnect` 等）
- 狀態改變與資源回收有多條寫入點（`openSocket`、`onclose`、`forceReconnect`、`disconnect`）
- 同一個 mutable reference（`this.ws`）由多路 async writer 操作

所以，結論是：
- 這不是再加 guard 的問題；
- 要做的是「單一控制平面（single control plane）」，由 `WsClientService` 決定所有重連/釋放/排程順序；
- 重連時序要從「被動補救式」改成「可排隊可判斷」的流程。

## 我們已做過的修補（含副作用）

1. `connect` 設立即重連（`21500f3`）
   - 解決：background 之後回來的長等待（backoff）。
   - 副作用：重連觸發點擴散到 `visibilitychange`。
2. `pageshow` 覆蓋 BFCache（`47d42d8` + `e8d9e04`）
   - 解決：首次 load 重接、BFCache 邊界。
   - 副作用：事件驅動進入更多並發通道。
3. `ping/pong` probe（`15e9735`）
   - 解決：`readyState===OPEN` 但 TCP 死掉（zombie）時的黑洞。
   - 副作用：新增 `probe -> reconnect` 分支，導致並發排序複雜度上升。
4. `forceReconnect` 抽取 + `shouldReconnect` guard（`b4ba995`）
   - 解決：重複邏輯與 disconnect 時競態。
   - 副作用：仍保留多處可直接改 `this.ws`，只是封裝少了，未根治核心所有權問題。

## 根因地圖

- 這條事故鏈本質是「同一資源被多 writer 同時控制」而非某個 API 行為錯誤。
- Safari 的 `visibility/pageshow` 特性會放大排序差異，不是因為它特殊，所以每個 bug 都要用 extra guard 就能解；而是因為缺乏統一排序主控。
- `signal`（事件、readyState）不是事實（settled truth）；`probe` 只是把證據收集放進流程，仍要交給單一控制面做決策。

## 建議的持續方針（下一階段）

1. 建立「單一 writer」：`setConnection` / `clearConnection` 作為唯一 `this.ws` 改寫點（含 onclose/onerror/onmessage handler 清理）。
2. 建立「單一命令路徑」：
   - `ensureActiveConnection`、`forceReconnect`、`disconnect` 全部走同一個有序函式列（或 state machine）。
3. 事件版本化保護：
   - 每次 `openSocket`/關閉產生 `epoch`，舊 event 到達時先比對 `epoch`，不符則 ignore。
4. 重新定義 `pendingRequests` 釋放規則：
   - 只清理「該連線生命週期」中的 pending，不要在非預期事件裡一次性全清，避免額外副作用。
5. 通用 UI 防護：
   - 不只 Workspaces page；以 `connectionState` 作全域操作 gate，避免「看得到但其實在洞中」的行為。

## 這次討論的學習結論

> 在這個專案脈絡下，問題本質是「Race Condition」沒錯，但更精準叫法是「控制面碎片化」。  
> 解法是把重連邏輯從「多路條件拼接」改成「集中式生命週期控制」。

