# ws-client Singleton 收口重構

Created: 2026-04-23
Status: 問題定義 — 待 iOS Simulator 觀察 + 結構設計

## 問題摘要

Safari / iOS PWA 背景恢復後，WebSocket 連線頻繁卡在 `Reconnecting... (connecting)` 狀態。已經修了三輪（BANK-002 → BANK-003 → 追加 race fix），問題仍未根治。根因不是個別 bug，是 `ws-client.ts` 的結構性問題。

## 症狀

- iOS Safari PWA 切到背景再切回 → 顯示 `Reconnecting... (connecting)` 黃色 banner
- Chrome 完全正常，問題只在 Safari / iOS PWA
- 有時會自動恢復，有時卡死需要手動重新整理
- Banner 顯示 `(connecting)` 表示 `openSocket()` 被呼叫了但 `onopen` 沒觸發

## 結構性根因

`ws-client.ts`（`frontend/src/services/ws-client.ts`）是 class-based singleton，核心問題是 **`this.ws` 這個 mutable reference 有多個 async writer 在競爭**：

### 4 個 async writer

| Writer | 觸發時機 | 對 `this.ws` 做什麼 |
|--------|----------|---------------------|
| `openSocket()` | connect / reconnect timer / forceReconnect / ensureActiveConnection | `this.ws = new WebSocket(url)` |
| `onclose` handler | socket 關閉（含延遲觸發） | `this.ws = null` |
| `forceReconnect()` | probe 失敗 / zombie 偵測 | `this.ws.close()` → `this.ws = null` → `openSocket()` |
| `disconnect()` | 使用者主動斷線 | `this.ws.close()` → `this.ws = null` |

### 競爭場景（已知）

```
時序 A（onclose 延遲）:
  openSocket() → this.ws = ws2
  ws1.onclose 延遲觸發 → this.ws = null  ← ws2 被誤殺
  ws2.onopen → 但 this.ws 已經是 null

時序 B（visibilitychange + onclose 競爭）:
  Safari 背景恢復 → visibilitychange 觸發
  ensureActiveConnection → forceReconnect → openSocket() → this.ws = ws2
  同時 ws1.onclose 也觸發 → reconnect() → openSocket() → this.ws = ws3
  結果：ws2 變 orphan，ws3 才是 this.ws

時序 C（Safari BFCache）:
  pageshow persisted=true → ensureActiveConnection
  ws.readyState === OPEN 但 TCP 已死 → probe → 3s timeout
  timeout 期間 visibilitychange 也觸發 → 再一次 ensureActiveConnection
  兩條路徑可能同時呼叫 forceReconnect
```

### 之前的補丁

| 版本 | 做了什麼 | 為什麼不夠 |
|------|----------|-----------|
| v1 `15e9735` | ping-pong probe on visibilitychange | 沒處理多個 writer 競爭 |
| v2 `b4ba995` | 提取 `forceReconnect()`、`shouldReconnect` guard | 戰術修復，沒改結構 |
| v3 (uncommitted) | `reconnectTimer` 防 double-open、`readyState > OPEN` 不殺 CONNECTING | 又是 guard，問題還在 |

每一輪都是在「猜可能的 race condition → 加 guard」，而不是消除 race condition 產生的條件。

## 正確解法方向（來自 BANK-003）

**把 `this.ws` 的寫入收口到單一入口**，而不是加更多 guard。

### 核心原則

> Ownership 決定解法層級：ws-client 是我們自己的 singleton，能改結構就不該加 guard。
> — BANK-003

### 設計方向

1. **單一寫入方法** `setConnection(ws: WebSocket | null)`
   - 所有對 `this.ws` 的修改都必須通過這個方法
   - 方法內負責：清理舊 socket handlers → 設定新 socket → 通知 state listeners
   - 外部不能直接 `this.ws = ...`

2. **State machine**（建議評估）
   - 目前用散落的 flag（`shouldReconnect`、`probing`、`reconnectTimer`）控制行為
   - 考慮改為明確的 state machine：`disconnected → connecting → connected → reconnecting`
   - 每個 state 只允許特定轉換，非法轉換直接 ignore

3. **Transport / Session 分層**
   - Transport 層：只管 socket 生命週期（open / close / reconnect）
   - Session 層：workspace selection、pending requests、message routing
   - `onclose` 只清 transport 資源，不動 session 狀態

## iOS Simulator 觀察任務

**目的**：用精確的事件 log 確認實際發生的時序，而不是繼續猜。

### CLI 觀測命令（可重複觀測）

在 macOS terminal 直接開啟 PWA URL（避免 GUI 介面重複點擊造成時序偏差）：

```bash
xcrun simctl openurl booted "http://<Mac-LAN-IP>:4801/?code-viewer:debug=true"
```

建議使用 `while` 迴圈重複驗證長時間背景還原 / 重連行為：

```bash
for i in {1..20}; do
  printf 'openurl #%d\\n' "$i"
  xcrun simctl openurl booted "http://<Mac-LAN-IP>:4801"
  sleep 2
done
```

> 回報：`CoreSimulatorService connection became invalid` 已可透過「先重啟 CoreSimulatorService + 重啟 Simulator」來緩解；若仍持續，先回報觀測輸出及 timestamp，改到下一輪修補前先停掉非必要的 GUI 重試步驟。

### 環境設定

1. 開 Xcode → iOS Simulator（iPhone 15 / iOS 17+）
2. Simulator 裡開 Safari → 加到主畫面（PWA 模式）
3. Mac Safari → Develop menu → Simulator → 連 Web Inspector
4. Frontend 連到 `http://<Mac-LAN-IP>:4801`，Backend 在 `:4800`

### 需要觀察的 console log

`ws-client.ts` 已有 debug logging（`setState`、`visibilitychange`、`pageshow`），確認 `localStorage code-viewer:debug=true` 已開啟。

### 重現步驟 & 要記錄的數據

**Step 1 — 基本連線**
- 開 PWA → 確認 connected → 選 workspace → 進 file view
- 記錄：`setState` log 順序

**Step 2 — 短暫背景（< 5s）**
- Home 鍵切出 → 等 3 秒 → 切回
- 記錄：`visibilitychange` / `pageshow` 是否觸發、`ws.readyState` 值、probe 是否成功

**Step 3 — 長時間背景（30s+）**
- Home 鍵切出 → 等 30 秒 → 切回
- 記錄：`visibilitychange` / `pageshow` 觸發順序、`readyState` 值、probe 結果、`onclose` 是否觸發及時機

**Step 4 — 連續切換（壓力測試）**
- 快速切出切入 5 次（每次間隔 1-2 秒）
- 記錄：是否產生多個 `openSocket` 呼叫、`this.ws` 是否被覆蓋

**Step 5 — BFCache**
- 在 Safari 裡（不是 PWA）開頁面 → 導航到別的網站 → 按返回
- 記錄：`pageshow persisted` 值、socket 狀態

### 要回答的問題

1. Safari 背景凍結後，`ws.readyState` 的實際值是什麼？（OPEN? CLOSING? CLOSED?）
2. `visibilitychange` 和 `onclose` 的觸發順序是什麼？（哪個先？間隔多久？）
3. BFCache restore 時 `pageshow` 是否觸發？`persisted` 是 true 還是 false？
4. 快速切換時，是否真的產生多個 concurrent `openSocket` 呼叫？
5. 問題是「socket 建不起來」還是「socket 建起來了但 state 沒更新」？

## 相關檔案

| 檔案 | 角色 |
|------|------|
| `frontend/src/services/ws-client.ts` | 核心 — WS singleton，重構目標 |
| `frontend/src/hooks/use-websocket.ts` | React hook，消費 ws-client state |
| `frontend/src/pages/workspaces/index.tsx` | Reconnecting banner 顯示邏輯 |
| `backend/src/ws/handler.ts:246` | Backend ping handler |
| `backend/src/ws/manager.ts` | Backend frontend stale detection |
| `.bank/BANK-003-safari-zombie-ws@2026-04-22.md` | 學習紀錄，含 3 個心智模型 |

## 不在這次範圍

- Backend 架構改動（backend frontend stale detection 已獨立完成）
- 新功能（PWA icons、bookmarks 等）
- 非 Safari 的 WS 問題（Chrome 完全正常）
