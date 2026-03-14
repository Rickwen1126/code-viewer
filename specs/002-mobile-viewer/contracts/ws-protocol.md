# WebSocket Protocol: Mobile Code Viewer

**Branch**: `002-mobile-viewer` | **Date**: 2026-03-14
**Input**: [data-model.md](../data-model.md), [spec.md](../spec.md)

---

## 概觀

系統有兩條獨立的 WebSocket 連線：

```
Extension ──ws──▶ Backend ◀──ws── Frontend
(WS client)      (WS server)     (WS client)
```

- **Extension → Backend**: Extension 主動連向 Backend（Extension 不開 port）
- **Frontend → Backend**: Frontend 主動連向 Backend

所有訊息格式統一為 JSON，共用 `WsMessage` 型別。

---

## 連線端點

### Extension 端點

```
ws://{BACKEND_HOST}:{PORT}/ws/extension?id={extensionId}&name={displayName}
```

| Query Param | 說明 |
|-------------|------|
| `id` | Extension 唯一識別碼（format: `{machineName}-{pid}`）|
| `name` | 顯示名稱（workspace folder name）|

### Frontend 端點

```
ws://{BACKEND_HOST}:{PORT}/ws/frontend
```

Frontend 連線後透過 `selectWorkspace` 訊息選擇要連哪個 Extension。

---

## 訊息格式

所有 WS 訊息遵循統一格式：

```typescript
interface WsMessage {
  type: string           // 訊息類型
  id: string             // 訊息 ID（UUID v4），用於 request/response 配對
  replyTo?: string       // 回覆的訊息 ID（response 類型必填）
  payload: unknown       // 訊息內容
  timestamp: number      // 發送 timestamp（ms）
}
```

### 訊息類型命名規則

```
{domain}.{action}          // Request
{domain}.{action}.result   // Response（成功）
{domain}.{action}.error    // Response（失敗）
{domain}.{event}           // Event（單向推送）
```

Domain 列表：`connection`、`workspace`、`file`、`lsp`、`git`、`chat`、`review`、`tour`

---

## 連線生命週期

### Extension 連線流程

```
1. Extension → Backend: [ws connect]
2. Backend → Extension: connection.welcome { backendVersion }
3. Extension → Backend: workspace.register { workspace info }
4. Backend → Extension: workspace.register.result { ok }
5. [heartbeat loop starts: Backend ping every 30s]
6. Extension → Backend: [respond to requests from Frontend]
```

### Frontend 連線流程

```
1. Frontend → Backend: [ws connect]
2. Backend → Frontend: connection.welcome { backendVersion }
3. Frontend → Backend: connection.listWorkspaces {}
4. Backend → Frontend: connection.listWorkspaces.result { workspaces[] }
5. Frontend → Backend: connection.selectWorkspace { extensionId }
6. Backend → Frontend: connection.selectWorkspace.result { workspace }
7. [Frontend is now bound to that Extension]
```

### Heartbeat

```
Backend → Extension: [ws ping frame] (every 30s)
Extension → Backend: [ws pong frame] (automatic by ws library)

Backend → Frontend: [ws ping frame] (every 30s)
Frontend → Backend: [ws pong frame] (automatic by browser)
```

如果 40 秒未收到 pong，Backend 標記該連線為 `stale`。
Stale 連線若 5 分鐘內未重連，Backend 強制移除並發送 `connection.extensionDisconnected`（reason: `timeout`）。

---

## Request/Response Pattern

Frontend 發送 request → Backend relay → Extension 處理 → 原路返回。

```
Frontend                 Backend                  Extension
   │                        │                         │
   │── file.read ──────────▶│── file.read ───────────▶│
   │                        │                         │
   │◀── file.read.result ──│◀── file.read.result ────│
   │                        │                         │
```

**Backend 行為**：
1. 收到 Frontend request
2. 檢查 Frontend 是否已 `selectWorkspace`
3. 將 request 原封不動轉發給對應 Extension
4. 收到 Extension response 後原封不動轉回 Frontend
5. **快取策略**：`file.tree` 和 `workspace.info` 的結果會在 Backend 快取

**超時**：Frontend request 超過 30 秒未收到 response，Backend 回傳 timeout error。

---

## Event Pattern（單向推送）

Extension 或 Backend 主動推送事件給 Frontend：

```
Extension                Backend                  Frontend
   │                        │                         │
   │── file.changed ───────▶│── file.changed ────────▶│
   │                        │                         │
```

**Backend 行為**：
1. 收到 Extension event
2. 檢查是否有 Frontend 正在觀察該 Extension
3. 有則轉發，無則丟棄
4. 部分 event 會更新 Backend 快取（如 `file.treeChanged`）

---

## Streaming Pattern（Chat）

Chat 回答使用 streaming pattern：

```
Frontend                 Backend                  Extension
   │                        │                         │
   │── chat.send ──────────▶│── chat.send ───────────▶│
   │                        │                         │
   │◀── chat.stream.chunk ─│◀── chat.stream.chunk ──│  (N 次)
   │◀── chat.stream.chunk ─│◀── chat.stream.chunk ──│
   │◀── chat.stream.chunk ─│◀── chat.stream.chunk ──│
   │                        │                         │
   │◀── chat.send.result ──│◀── chat.send.result ───│  (完成)
   │                        │                         │
```

`chat.stream.chunk` 的 `replyTo` 對應原始 `chat.send` 的 `id`。

---

## 錯誤格式

所有 error response 遵循：

```typescript
interface ErrorPayload {
  code: string         // 機器可讀的錯誤碼
  message: string      // 人類可讀的錯誤訊息
}
```

常用錯誤碼：

| Code | 說明 |
|------|------|
| `NOT_CONNECTED` | Frontend 尚未選擇 workspace |
| `EXTENSION_OFFLINE` | 對應的 Extension 已離線 |
| `TIMEOUT` | Extension 30 秒未回應 |
| `NOT_FOUND` | 請求的資源不存在 |
| `INVALID_REQUEST` | 訊息格式錯誤 |
