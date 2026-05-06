# BANK: Safari Zombie WebSocket Fix

tags: [bank, websocket, safari, singleton, ownership, design-pattern, ai-collaboration]

## Relations
- follows [[AUDIT-safari-zombie-ws-v1@2026-04-22]]
- extends [[BANK-002-mobile-viewer-v1@2026-03-21]]

## 做了什麼
診斷 Safari 背景恢復後 zombie WebSocket（readyState OPEN 但 TCP 已死 → 30s timeout），實作 visibilitychange ping-pong probe + forceReconnect + reconnecting UI。Code review 發現重複邏輯與 disconnect race，提取 forceReconnect 並加 shouldReconnect guard。完成 SHIP → AUDIT → BANK 完整學習循環。

## 學到什麼

1. 下次遇到 **AI 協作建出的多模組系統出 bug** 要 **回頭檢查 design pattern 層級的定義是否到位**，因為架構邊界（模組、interface）定義清楚不代表模組內部的 pattern 也清楚。這次 frontend 和上次 backend 出的是同根結構的問題：cleanup handler 管轄範圍太廣 — transport 層的 event 有權操作 session/reference 層的狀態。AI 會遵守你給的架構邊界，但邊界內部的 design pattern 如果沒定義，AI 會用最直覺的方式寫，而最直覺的方式往往是把相關邏輯全塞在同一個地方。
2. 下次遇到 **singleton 有多個 async writer 共享 mutable reference** 要 **把所有寫入收口到單一入口**，不是加 guard 去偵測 stale。Guard（如 generation ID、cancelled flag）是碰不到系統層時的 workaround；自己寫的 singleton 可以直接改結構，讓散落的寫入點在設計上不可能存在。
3. 下次遇到 **某個 workaround pattern 在框架裡很常見** 要 **先問「我對這段程式碼的 ownership 到哪裡」**，因為 ownership 決定你該用什麼層級的解法。React useEffect 裡用 `cancelled` flag 是因為 Fiber（reconciler 管 hooks 的內部資料結構）是 React 系統層，你碰不到。但 ws-client 是你自己包的，能改結構卻選擇加 guard，等於把框架限制下的 workaround 搬到你擁有完整控制權的地方。
4. 下次遇到 **前端修好了連線問題但 backend 沒動** 要 **檢查 backend 側的對應清理機制**，因為 zombie socket 的 TCP close frame 可能送不到 backend，backend 的 onClose 不會觸發，manager 裡會殘留 orphan entry。目前 backend 只有 extension 有 heartbeat/stale 偵測，frontend 完全沒有。

## 心智模型

### Ownership 決定解法層級
**機制**：程式碼的 ownership 層級（碰不到 / 可配置 / 完全擁有）決定你能用什麼層級的解法。碰不到系統內部 → 只能在外部加 guard/workaround。完全擁有 → 應該改結構，消除問題產生的條件。
**故障模式**：把「碰不到才用的 workaround」搬到「自己擁有的程式碼」裡。例如在自己寫的 singleton 裡用 generation ID（React useEffect 的 cancelled flag 翻版），而不是把 mutable reference 的寫入收口。結果是：結構問題沒解，guard 在邊界情況可能漏，而且下一個開發者看到 guard 會以為「這是必要的複雜度」。
**防護**：拿到一個 pattern 時先問三個問題：(1) 這個 pattern 原本是在什麼限制下產生的？(2) 我現在有那個限制嗎？(3) 如果沒有，我能用更根本的方式解嗎？
**適用場景**：任何從框架/函式庫學到的 pattern 要搬到自己的程式碼時。特別是 React pattern → 非 React 程式碼、框架 workaround → 自建系統。

### Cleanup Handler 管轄範圍原則
**機制**：cleanup handler（onClose、useEffect return、finally block）應該只清理它所在層級建立的資源。Transport 層的 onClose 只該清 transport 資源（socket reference、event handlers），不該動 session 層的狀態（workspace selection、pending requests routing）。
**故障模式**：cleanup 管太廣 → 一個 transport 閃斷把 session 也砍了 → 重連後要重建整個 session。這次 frontend 的 `forceReconnect` 和上次 backend 的 `onClose → removeExtension` 是同一個結構：transport event 越權操作 session 狀態。
**防護**：寫 cleanup handler 時列出它會清理的東西，逐項問「這個資源是誰建立的？」如果是上層建立的，cleanup 只能標記狀態（如 `stale`），不能直接刪除。
**適用場景**：任何分層架構的連線管理、React component 的 useEffect cleanup、資料庫 connection pool 的回收邏輯。

### Singleton Mutable Reference 收口
**機制**：class-based singleton 的 mutable reference（如 `this.ws`）如果有多個 async writer，每個 writer 都假設自己寫入時 reference 指向的是自己期望的物件。但 async 操作交錯時，reference 可能已經被別的 writer 換掉了。
**故障模式**：openSocket 建新 ws → 舊 ws 的 onclose 延遲觸發 → null 掉新 ws → 新 ws 的 onopen 觸發時 this.ws 已經是 null → 狀態不一致。
**防護**：(1) 所有對 mutable reference 的寫入集中到一個方法（如 `setConnection(ws)`）(2) 該方法負責清理舊的、設定新的、通知 listener (3) 外部不能直接 `this.ws = ...`，只能呼叫收口方法。
**適用場景**：任何 singleton / service class 持有需要替換的資源（WS 連線、DB connection、worker thread reference）。

## 累積項目追蹤

| 觸發器 | 來源 | 本次驗證 |
|--------|------|----------|
| Heartbeat = ping + pong，缺一無效 | BANK-002 | ✅ 直接命中。前端 probe 就是 application-level ping-pong。 |
| Error 吞掉 + Timeout = 最差 UX | BANK-002 | ✅ **這就是被修的 bug**。Zombie send 靜默成功 → 30s timeout。 |
| Transport 與 Session 應分離 | BANK-002 | ⚠️ 仍未結構性解決。forceReconnect 是戰術修復，session rebind 靠 React effect chain 隱式處理。 |
| Signal ≠ Settled Truth | AUDIT-race-conditions | ✅ readyState 是 signal，ping-pong 是 end-to-end verification。 |
| Cleanup handler 管轄範圍 | **本次新增** | 兩次迭代同根結構，提煉為通用原則。 |
| Ownership 決定解法層級 | **本次新增** | 從 generation ID vs 收口的討論中提煉。 |
| Singleton mutable reference 收口 | **本次新增** | ws-client 4 個 async writer 共享 this.ws。 |
| Backend frontend stale 偵測 | **本次新增** | 前端 orphan socket close frame 送不到 backend，manager.frontends 殘留。待實作。 |

## 下次改進

**做對的（保持）：**
- Visibilitychange-only probe 設計精準命中問題，零正常開銷
- Code review 抓到重複邏輯 + disconnect race，修復後更乾淨
- SHIP → AUDIT → BANK 完整循環，每步都有新發現
- Insight brainstorming 在上下文最豐富時做，品質明顯更好

**做錯的（下次改）：**
- AI 協作時只定義架構邊界，沒定義模組內 design pattern → 下次 spec/plan 裡加 pattern 約束（如 "mutable state 寫入必須收口"）
- forceReconnect 是戰術修復，singleton 結構問題仍在 → 排進後續重構
- Backend frontend stale 偵測完全沒有 → 排進後續功能

## 累積統計
本專案已完成 2 輪迭代（BANK-002 + BANK-003）
