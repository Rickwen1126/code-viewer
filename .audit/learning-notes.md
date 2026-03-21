# AUDIT Learning Notes

## A2-1: Backend relay 應是 session broker，不只是 transport forwarder

**發現**：Extension WS 斷線時 `onClose` 立即 `removeExtension`，所有 pending requests 留在 Map 裡等 30s timeout。stale 機制（40s→5min）只在 heartbeat timeout 時生效，`onClose` 不走 stale 流程。

**Rick 的洞察**：
- WS 連線（transport）跟 Extension 身份（session）應該分離
- Backend 已經有 Extension ID（`?id=machineName-pid`），但 `onClose` 把 session 連同 transport 一起刪了
- 正確做法：斷線 → 標 offline → queue 訊息 → 重連同 ID → flush queue
- 這讓 relay 從「無狀態轉發」升級為「session broker with message queue」

**影響**：
- 短期：`onClose` 應走 stale 流程而非立即 remove + 主動 drain 對應的 pending requests
- 長期：Backend relay 的職責定義需要重新審視 — Constitution §V「後端極簡」的邊界在哪

---

## A2-3: Copilot Chat session 歷史是有意的 MVP 取捨

**事實**：
- Constitution §VIII 明確寫了讀 `.jsonl` + `openSessionInEditorGroup` 的方案
- 但 API 穩定度被標為 tier 3（最低），Constitution 自己寫「主力用 Public API 可不依賴」
- 實作只用 tier 1 的 `vscode.lm` API（發新訊息），沒碰 tier 3 介面
- SHIP 沒有安排 spike 實驗驗證 tier 3 API 的可行性

**結論**：不是遺漏，是風險管理 — 先用穩定 API 交付核心功能，不穩定的 session 歷史讀取留到後續

**需要 spike 的項目**：
1. `.jsonl` 實際路徑和格式（undocumented，`~/.config/Code/User/workspaceStorage/{hash}/...`）
2. `openSessionInEditorGroup` command 的參數格式和行為
3. 這些介面在 VS Code 版本升級時的穩定性（追蹤 `microsoft/vscode-copilot-chat` MIT repo 的 diff）

**Spike 結果（2026-03-21）**：
- 路徑確認：`~/Library/Application Support/Code/User/workspaceStorage/<hash>/chatSessions/*.jsonl`
- 329 個 session 檔案，跨 85 個 workspace
- 格式：event-sourced log（`kind: 0` init / `kind: 1` patch / `kind: 2` splice）
- User message: `request.message.text`，Copilot response: `request.response[].value`
- 成功從 12-turn session 完整還原所有對話
- **結論：可行，但格式 undocumented，需 pin `version: 3` + graceful fallback**

---

## A2-4: Map 遍歷中 delete — 語言允許但應改為防禦性寫法

**事實**：JS `Map` 的 `for...of` 遍歷中 `delete` 當前 entry 是 ECMAScript 規格明確允許的安全操作。Java 的 `HashMap` 同樣操作會拋 `ConcurrentModificationException`。

**Rick 的判斷**：即使語言允許，這種寫法就像把人綁在懸崖旁邊跟他說很安全 — 誰看了都覺得危險。跨語言背景的開發者會本能認為是 bug。

**Action**：改為收集再批次刪除
```typescript
// backend/src/ws/manager.ts heartbeat loop
const toRemove: string[] = []
for (const [id, entry] of this.extensions) {
  if (shouldRemove) toRemove.push(id)
}
for (const id of toRemove) this.extensions.delete(id)
```

**原則**：code 的可讀性和安全感比語言特性的技術正確性重要。防禦性寫法的成本（多兩行）遠低於誤解的風險。

---

## C2: Error model 統一兜底 — routing 層包 try/catch（待修，Phase 9 前）

**問題**：每個 provider 自己寫 try/catch，漏了就變 30s timeout。使用者體驗差距 = 2 秒 vs 30 秒知道失敗。

**修法**：routing 層（dispatch table `.catch`）統一送 `.error` response，provider 不需要記得寫 try/catch。
```typescript
handler(message, sendResponse, client).catch((err) => {
  sendResponse(createMessage(message.type + '.error', {
    code: 'INVALID_REQUEST', message: String(err),
  }, message.id))
})
```

**影響**：一個地方改，19 個 handler 全部受益。配合 dispatch table 重構一起做。

**Rick 決定**：Phase 9 前修掉，跟 dispatch table 重構一起提交。

---

## C3: Timeout vs response 的 double reply — 顯性檢查優於隱性語言保證

**場景**：relay.ts 的 30s timeout callback 跟 Extension response 幾乎同時到。Event loop 保證它們不會「同時」執行，但如果 response 先到（delete pending entry + clearTimeout），timeout callback 仍然會觸發（clearTimeout 只阻止尚未排入 event loop 的 timer）。

**問題**：timeout callback 裡沒有檢查 pending entry 是否還存在。`delete` 不存在的 key 不會拋 error，但後面的 `sendToWs(makeErrorMessage)` 照跑 — Frontend 收到**兩個回覆**（正常 response + TIMEOUT error）。

**修法**：
```typescript
setTimeout(() => {
  if (!pendingRequests.has(msg.id)) return  // 顯性檢查
  pendingRequests.delete(msg.id)
  sendToWs(fe.ws, makeErrorMessage(...))
}, 30000)
```

**Rick 的判斷**：跟 A2-4 同一個原則 — 語言機制（event loop 單線程）幫我們避免了 data corruption，但 double reply 是應用層的 bug。不應該靠語言機制的隱性保證，要在 code 裡顯性防護。

**Action**：Phase 9 前跟 dispatch table + error 兜底一起修。

---

## C5: Relay timestamp log — 最小 instrumentation 定位「哪一段慢」（待修，Phase 9 前）

**問題**：使用者回報「點檔案很久才出來」，目前無法區分是 Frontend→Backend 網路慢、Extension API 慢、還是 Backend→Frontend 網路慢。

**洞察**：`WsMessage.timestamp` 已經存在於每個訊息裡。只要 Backend relay 在轉發時 log timestamp 差值，就能定位瓶頸：
- `T_backend_received - T_frontend_sent` = 上行網路延遲
- `T_extension_response - T_frontend_sent` = Extension 處理時間
- 完整 round-trip = Frontend 自己算 `Date.now() - sendTime`

**修法**：Backend relay 加兩行 log：
```typescript
// relayFrontendToExtension
console.log(`[relay] ${msg.type} ${msg.id} → extension (age: ${Date.now() - msg.timestamp}ms)`)

// relayExtensionResponseToFrontend
console.log(`[relay] ${msg.type} ${msg.id} ← extension (total: ${Date.now() - originalTimestamp}ms)`)
```

**成本**：2 行 code。**效益**：任何「很慢」的回報都能立即定位到具體 segment。

**Action**：Phase 9 前一起修。
