# AUDIT: Safari Zombie WS v1

tags: [audit, code-viewer, websocket, safari, reconnection]

## Relations
- follows [[SHIP-safari-zombie-ws@2026-04-22]]
- extends [[BANK-002-mobile-viewer-v1@2026-03-21]]
- extends [[AUDIT-code-viewer-race-conditions-v1@2026-04-15]]

## 產出類型
軟體產品

## 通用核心

### A1 Contract
**Safari 背景恢復後 5 秒內自動偵測 zombie socket + 重連，使用者看到明確的 reconnecting 狀態。**

SHIP 偏移檢查：**一致**。Problem Statement 聚焦 Safari zombie，解法是 visibilitychange ping probe，成功條件 5 秒恢復。實際產出完全符合：3s probe timeout + ~2s reconnect ≈ 5s。

### A2 Failure Modes
1. **Ping 因網路恢復慢而 false positive（WiFi/Tailscale handoff 超過 3 秒）。**
   - 證據：`ws-client.ts:107` timeout 硬編碼 3000ms
   - 證據：SHIP 分析 WiFi + Tailscale tunnel 恢復通常 < 2s，3s 有 buffer
   - 影響：不嚴重 — false positive 只是多一次重連（~2s），等同真的斷線的體驗
   - → Exit Q: 在什麼網路拓撲下 3 秒會變成常態性 false positive，而不只是偶發？ [A]

2. **Backend 事件迴圈忙碌，pong 回覆延遲超過 3 秒。**
   - 證據：`handler.ts:246-248` ping handler 是同步的，但排在 `onMessage` callback queue 裡
   - 證據：backend 同時處理多個 extension 的 file tree / git diff 轉發
   - 影響：理論上可能，但 ping handler 是 3 行同步 code，不會被 block；真正的瓶頸是 Node event loop，目前 backend 沒有 CPU-bound 操作
   - → Exit Q: Node.js 單執行緒模型下，什麼情況會讓一個同步的 3 行 handler 被延遲超過 3 秒？ [A]

3. **Probe 成功但 WS 在 pong 回來後立即死亡（極短存活窗口）。**
   - 證據：probe 成功後沒有持續監控，下一次檢查要等下一次 `visibilitychange`
   - 影響：使用者的下一個操作（例如點 workspace）會走正常的 `request()` 30s timeout 路徑
   - → Exit Q: probe 驗活後的「信任窗口」有多長？有沒有需要在窗口內加二次確認？ [A]

4. **其他頁面（file browser、tour detail）也有 zombie 問題，但沒有 reconnecting UI 保護。**
   - 證據：只有 `workspaces/index.tsx` 加了 `wsReady` 判斷
   - 影響：其他頁面已有各自的 error handling + retry 或 loading state，但沒有「不可操作」的明確提示
   - → Exit Q: 除了 WorkspacesPage，哪些頁面在 WS 斷線時會產生「看起來正常但不可操作」的 zombie UX？ [A]

### A3 Trade-offs
- 替代 A：**定期心跳（每 N 秒 ping）** → 不選原因：正常使用持續消耗流量、手機背景 timer 被 throttle 效果差、增加 server 負載。問題只在 visibilitychange 場景。
- 替代 B：**request() 裡加 pre-flight check** → 不選原因：每次操作多一次 RTT 拖慢 UX、改動範圍大（所有 request 路徑都受影響）、正常連線時也增加延遲。

SHIP 一致性檢查：**完全一致**，三個方案和選擇理由跟 SHIP 記錄相同。

### A4 AI 盲點
1. **假設 `ws.send()` 在 zombie socket 上不會拋錯。**
   - ⚠️ 需驗證：大多數瀏覽器實作中 `send()` 在 `readyState === OPEN` 時不拋錯，即使底層 TCP 已死。但 WebSocket spec 只規定 `CONNECTING` 時拋 `InvalidStateError`，`OPEN` 時的行為在 zombie 情境下屬 implementation-defined。
   - 驗證方式：在 Safari 上實際重現（長背景 → 回來 → 觀察 console 是否有 send error）

2. **假設 `forceReconnect` 裡 `ws.close()` 一定能正常執行。**
   - ✅ 可信：`try { this.ws.close() } catch { /* ignore */ }` 已包裹在 try-catch 裡。即使 close 拋錯也不影響後續的 drain + openSocket。

3. **假設 reconnecting banner 一定會在重連成功後消失。**
   - ✅ 可信：`wsReady = connectionState === 'connected'`，而 `connectionState` 由 `useSyncExternalStore` 從 ws-client 的 state listener 取得。`openSocket` 成功後 `onopen` 觸發 `setState('connected')` → listener fire → React re-render → banner 消失。chain 是同步的（state → listener → React）。

### A5 受眾價值
**受眾**：自己（iPhone 用 Safari/PWA 透過 Tailscale 連 Code Viewer 的唯一使用者）
**拿到後能做**：背景恢復後不再卡 30 秒；看到 reconnecting 就知道在恢復中，不用手動刷新。
**是否解決 SHIP 定義的問題**：是。

## Code 延伸

### C1 Lifecycle
- **`probeConnection` lifecycle**：`probing = true` → `request()` → `.then/.catch` → `.finally { probing = false }`。對稱 ✓
- **`forceReconnect` lifecycle**：null handlers → close → null ws → drain → openSocket。建立-釋放對稱 ✓
- **Idempotent guard**：`ensureActiveConnection` 在 `probing` 進行中不會重複觸發（`probing` flag + state check at L97）✓
- **`disconnect()` 中斷**：probe catch 裡的 `shouldReconnect` guard 防止 disconnect 後誤觸重連 ✓

→ Exit Q: `forceReconnect` 裡先 null handlers 再 close，跟先 close 再 null handlers，runtime 行為有什麼差異？ [A]

### C2 Error Model
- **Ping timeout**：`request()` 的 30s timeout 被 override 為 3s → reject → catch → `forceReconnect` → `openSocket` → onopen → `setState('connected')` → WorkspacesPage refetch
- **disconnect during probe**：catch guard `return` → `finally` reset `probing` → 不觸發重連 ✓
- **openSocket 失敗**：`new WebSocket()` catch → `reconnect()` with backoff ✓
- **Silent failure path**：如果 `ws.send()` 在 zombie 上靜默成功但訊息消失 → 3s timeout 兜底 ✓

→ Exit Q: 在 `probeConnection` 的 catch 裡，哪些 error 原因代表「連線真的死了」，哪些代表「暫時性失敗但不該強制重連」？ [A]

### C3 Concurrency
- **`probing` flag**：防止並行 probe ✓。但注意這是 boolean 不是 lock，在單執行緒 JS 裡夠用。
- **Race: visibilitychange 在 `forceReconnect` 進行中再觸發**：`ensureActiveConnection` L97 檢查 `state !== 'connected' && state !== 'connecting'`，此時 state 已是 `connecting` → 跳過 ✓
- **Race: WorkspacesPage connectionState effect vs user click**：兩者都被 `wsReady` gate 保護 ✓
- **Race: WorkspaceProvider auto-rebind vs user manual select**：這個 race 存在於修復之前，本次沒有改動也沒有惡化 ⚠️

→ Exit Q: `probing` 用 boolean 而不是 Promise/lock，在什麼執行模型下會出問題？ [A]

### C4 Side Effects
- **新增 side effect**：`probing` boolean（module-level class state）、pendingRequests 裡的 ping entry
- **Event listener 無新增**：probe 復用 `visibilitychange`，不加新 listener ✓
- **forceReconnect 的 handler nullification**：`onclose = null` 防止 `close()` 觸發 double-drain ✓

→ Exit Q: 如果 `forceReconnect` 不 null 掉 `onclose`，`close()` 觸發的 `onclose` handler 會做什麼？跟 `forceReconnect` 自己做的 drain + openSocket 疊加後會發生什麼？ [A]

### C5 Observability
目前 log 覆蓋：
- `console.warn('[WS] Zombie connection detected...')` — 非 OPEN readyState 偵測
- `console.warn('[WS] Ping failed...')` — probe timeout / zombie 偵測
- `dbg('Ping OK...')` — probe 成功（debug mode only）

**缺失**：
1. 沒有 log probe 開始（只有結果）→ 無法區分「沒觸發 probe」和「probe 進行中」
2. 沒有累計 metric（probe 觸發/成功/失敗次數）→ 無法量化 false positive 頻率
3. reconnecting banner 沒有 log → 無法從 console 確認 UI 狀態

建議（不急，累積到一定量再加）：
- `dbg('Probing connection on', reason)` — probe 開始時
- `dbg('Reconnecting banner shown/hidden')` — UI 狀態變化

→ Exit Q: 如果只看 console log，能不能區分「probe 沒觸發」和「probe 觸發了但結果還沒出來」？ [A]

## [R]isky 追蹤

| SHIP 標記 | 實際結果 | 處理 |
|-----------|----------|------|
| Safari freeze readyState 是 stale 快照還是 resume 時更新 | **未實驗驗證**，行為分析和網路資料一致指向 stale 快照。probe 設計上不依賴這個假設——即使 readyState 正確更新（走第一段 if），probe 永遠不觸發，不會壞 | 降級為 N：即使假設錯了也不影響正確性 |
| Tailscale DERP relay RTT 是否超過 3s | **未實驗驗證**，目前使用場景都是同 LAN，RTT < 50ms。DERP relay 典型 RTT 200-500ms（亞太 region），不太可能超 3s | 仍為 R：如果未來跨國使用需要重新評估 timeout |

## 累積項目檢查

| 觸發器（來自 BANK/AUDIT） | 這次情況 |
|--------------------------|----------|
| **Heartbeat = ping + pong，缺一無效**（BANK） | ✅ 直接相關，且正確實作了。Frontend 發 ping、backend 回 pong、frontend 靠 `replyTo` 自動 resolve。缺 pong 的情況走 3s timeout → forceReconnect。 |
| **Error 吞掉 + Timeout = 最差 UX**（BANK） | ✅ **這就是被修的 bug 本身**。Zombie socket 的 `send()` 靜默成功 → 訊息進黑洞 → 30s timeout = 最差 UX。現在用 3s probe 提前偵測。 |
| **Transport 與 Session 應分離**（BANK） | ⚠️ 相關但未觸及。目前 `forceReconnect` 重建 transport 後，session（workspace selection）由 `WorkspaceProvider` 的 `connectionState` effect 自動 rebind。分離是隱式的（靠 React effect chain），不是顯式的。 |
| **Signal ≠ Settled Truth**（AUDIT） | ✅ **直接命中**。`visibilitychange` 是 signal，`ws.readyState === OPEN` 是 local state，都不是 settled truth。Ping probe 把 signal 升級為 end-to-end verification — 等到 pong 才是 settled truth。這是之前「signal 不能當 authority」pattern 的又一個實例。 |

## 學習收穫

| Exit Question | Gap Type | 狀態 |
|---------------|----------|------|
| 在什麼網路拓撲下 3 秒 timeout 會變成常態性 false positive？ | A | 待回答 |
| probe 驗活後的「信任窗口」有多長？有沒有需要二次確認？ | A | 待回答 |
| `forceReconnect` 裡先 null handlers 再 close，跟反過來的差異？ | A | 待回答 |
| 如果 `forceReconnect` 不 null 掉 `onclose`，double-drain 後果？ | A | 待回答 |

## 判定
**結果**：通過

**後續建議（非 blocker）**：
1. 補 `probeConnection` 的單元測試（review 已標記，仍 open）
2. 加 probe 開始的 debug log（C5 observability）
3. 評估其他頁面是否需要類似的 `wsReady` 保護（A2-4）
