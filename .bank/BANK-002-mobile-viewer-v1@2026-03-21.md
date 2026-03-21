# BANK: 002-mobile-viewer v1

tags: [bank, websocket, react, vscode-extension, monorepo, relay-architecture]

## Relations
- follows [[AUDIT-002-mobile-viewer-v1@2026-03-21]]

## 做了什麼
從 spec 到 live demo：4 packages monorepo、三端 WS relay、6 User Stories、166 tests、8 critical security fixes、AUDIT + 4 findings 修正、3 runtime bugs 修正。三端在真機上跑通。

## 學到什麼

1. 下次遇到 **dispatch 多個 agent 做實作** 要 **在每個 prompt 裡明確要求寫測試**，因為 agent 不會主動寫測試，62 個 task 做完零測試。
2. 下次遇到 **多層系統骨架完成** 要 **立即做 smoke test（wscat 或 Playwright）**，因為越底層的假設錯了上面蓋的東西全部要重來。這次運氣好是 transport 層 bug 不是 protocol 層。
3. 下次遇到 **WS request/response pattern** 要 **在 routing 層統一 error fallback**，因為依賴每個 handler 自己 catch 一定會漏，漏了使用者就等 30 秒 timeout。
4. 下次遇到 **利用語言特性的邊界行為** 要 **寫顯性防護**，因為語言允許不代表安全（JS Map 遍歷 delete、依賴 event loop 避免 race）。跨語言背景的人會認為是 bug。
5. 下次遇到 **設定 WS/API 連線 URL** 要 **在 default 和 .env 裡都帶完整 path**，然後 **立即用 curl/wscat 驗證連通性**，因為 path 不對會 404 但被 reconnect loop 吞掉。

## 心智模型

### Secure Context 與 Web API Capability
**機制**：瀏覽器的部分 Web API（`crypto.randomUUID`、`DeviceMotionEvent.requestPermission`、`navigator.clipboard`）只在 secure context 下可用。Secure context = HTTPS 或 localhost。HTTP + LAN IP（如 `http://192.168.x.x`）不是 secure context。
**故障模式**：API 存在於 `window.crypto` 但 `randomUUID` 是 `undefined`。呼叫時拋 TypeError，但如果被 try/catch 吞掉，表現為功能靜默失效 — WS 連線成功但 request 全部不發。TypeScript 型別系統看不到 context 差異，編譯不會報錯。
**防護**：任何瀏覽器端的 `crypto.randomUUID()` 都要用 fallback wrapper。`typeof crypto?.randomUUID === 'function'` check + Math.random based UUID fallback。
**適用場景**：所有可能在非 HTTPS 環境（開發、內網、Tailscale）跑的 PWA / Web App。

### Heartbeat = ping + pong，缺一無效
**機制**：WS heartbeat 由 server 發 ping frame，client 自動回 pong frame（瀏覽器和 `ws` 套件都自動回）。但 server 必須**監聽 pong 事件**來更新 `lastHeartbeat` timestamp。只有 `lastHeartbeat` 被更新，stale 檢測才有意義。
**故障模式**：只發 ping 不聽 pong → `lastHeartbeat` 停在連線時間 → 40 秒後所有連線被標 stale → 功能間歇性失效（連上 → 40 秒可用 → stale → 斷線 → reconnect → 又 40 秒）。Code review 看起來 heartbeat 寫得很完整，必須跑起來才發現。
**防護**：1) `rawWs.once('pong', () => updateHeartbeat(id))` 2) 或用「任何 message 活動都重置計時器」取代嚴格 ping/pong 3) 寫 test 模擬 40 秒無活動場景。
**適用場景**：任何自建 WS heartbeat / health check 機制。

### Error 吞掉 + Timeout = 最差 UX
**機制**：多層 relay 系統（A→B→C）中，中間層的 error 被 `.catch(console.error)` 吞掉。Frontend 發了 request，Backend 轉給 Extension，Extension 拋 error，Backend catch 掉只 log，不回 error response。Frontend 的 pending request 等到 30 秒 timeout 才 reject。使用者看到 loading spinner 轉 30 秒。
**故障模式**：2 秒能知道失敗的事情變成 30 秒。N 個 handler 只要一個漏 catch 就出問題。
**防護**：Dispatch table + routing 層統一 `.catch` 兜底，一個地方寫一次 N 個 handler 免費受益。Handler 可自己 catch 做精細 error，但外層保底。
**適用場景**：任何有多個 handler 的 message router / request dispatcher。

### Transport 與 Session 應分離
**機制**：WS 連線是 transport，Extension 身份是 session。當前設計在 `onClose` 時同時刪除兩者 — transport 斷了 session 也消失。但 transport 可能只是暫時斷線（網路 flap），Extension 帶著同一個 ID 重連時應接上舊 session。
**故障模式**：網路閃斷 → `onClose` → `removeExtension` → 所有 pending request 孤兒化等 timeout → Extension 重連但是「全新」的 session → Frontend 要重新 selectWorkspace。
**防護**：`onClose` 走 stale 流程（標 offline，不刪 session）→ 重連同 ID 時接上舊 session → pending requests 可以被 replay 或主動 drain。
**適用場景**：任何通過不穩定網路連線的 client-server 架構。

## Runtime Findings

| 症狀 | 根因 | 為什麼 review 沒抓到 | 怎麼更早發現 |
|------|------|---------------------|-------------|
| IP 存取顯示空 workspace，localhost 正常 | `crypto.randomUUID()` 在非 secure context 是 undefined，`send()` 裡拋 error 被 catch 吞掉 | TypeScript 型別有 `randomUUID`，編譯不報錯；code review 看不到 runtime context 差異 | 在 `.env` 配好 IP 後立即用非 localhost 瀏覽器測一次 |
| Extension 連上 40 秒後 stale | `manager.ts` 發 `rawWs.ping()` 但沒監聽 pong，`lastHeartbeat` 永遠不更新 | Code review 看到 ping 邏輯覺得完整；Hono WSContext 不直接暴露 pong 事件 | 寫 integration test 模擬 40+ 秒連線，驗證不 stale |
| Frontend WS 連線 404 | `.env` 裡 WS URL 只寫 `ws://host:port`，沒帶 `/ws/frontend` path | URL 設定看起來合理（host + port），path 是 backend routing 層面的細節 | 設定完 URL 立即 `curl` 或 `wscat` 驗證 WS handshake |

## 下次改進

**做對的（保持）：**
- Monorepo + shared types 在 build time 抓型別不匹配
- Correlation ID (id/replyTo) protocol 設計正確，所有 runtime bug 都在 transport 層不在 protocol 層
- 平行 agent dispatch 加速（5 stories 同時跑）
- AUDIT Exit Questions 逐題走過比直接看報告學到更多

**做錯的（下次改）：**
- Agent prompt 沒要求測試 → 每個 agent prompt 加「寫測試並確認通過」
- Phase 2 checkpoint 沒做 smoke test → 連線骨架完成就跑三端 smoke test
- 先寫 6000+ 行再測 → 分段驗證，至少每個 Phase checkpoint 跑一次
- `.env` 設定沒驗證 → URL 設定完立即 curl/wscat 驗證

**流程調整：**
- 加入 `@vscode/test-electron` 做 Extension E2E
- BANK prompt 改為存 `.bank/` 進 git，不存 Obsidian（已更新 prompt）

## 累積統計
本專案已完成 1 輪迭代
