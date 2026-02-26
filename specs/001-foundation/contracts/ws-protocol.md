# WebSocket Protocol Contract：Foundation

Endpoint: `ws://<backend>/ws/vscode-bridge`
Protocol: JSON-RPC 2.0
Direction: 雙向（Backend ↔ Extension）

## 連線生命週期

1. Extension 啟動後主動連向 Backend
2. Backend 維護單一 active connection slot
3. 新連線取代舊連線（Extension restart 場景）
4. 斷線後 Extension 自動重連（指數退避：1s base, 2x, 60s max, ±20% jitter）
5. Heartbeat：Extension ping 每 25s，Backend 須回 pong，10s 無回應則斷線重連

## 方法定義

### fs/readDirectory

**Direction**: Backend → Extension
**Purpose**: 讀取目錄內容（含 gitignored 檔案）

**Request params**:
```json
{ "path": "/workspace/my-app/src" }
```

**Response result**:
```json
[
  { "name": "index.ts", "type": "file" },
  { "name": "components", "type": "directory" }
]
```

### fs/readFile

**Direction**: Backend → Extension
**Purpose**: 讀取檔案內容

**Request params**:
```json
{ "path": "/workspace/my-app/src/index.ts" }
```

**Response result**:
```json
{
  "content": "import { Hono } from 'hono'...",
  "size": 2048
}
```

**Error** — 檔案超過 5MB：
```json
{ "code": -32003, "message": "File too large (10485760 bytes)" }
```

### fs/stat

**Direction**: Backend → Extension
**Purpose**: 取得檔案資訊（大小、類型）

**Request params**:
```json
{ "path": "/workspace/my-app/package.json" }
```

**Response result**:
```json
{
  "type": "file",
  "size": 1234,
  "mtime": 1740000000000
}
```

### workspace/addFolder

**Direction**: Backend → Extension
**Purpose**: 動態加入 workspace folder（使用者選擇專案時觸發）

**Request params**:
```json
{ "path": "/workspace/my-app" }
```

**Response result**:
```json
{ "success": true }
```

### workspace/removeFolder

**Direction**: Backend → Extension
**Purpose**: 移除不活躍的 workspace folder

**Request params**:
```json
{ "path": "/workspace/my-app" }
```

**Response result**:
```json
{ "success": true }
```

## JSON-RPC 2.0 訊息範例

### Request（Backend → Extension）

```json
{
  "jsonrpc": "2.0",
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "method": "fs/readDirectory",
  "params": { "path": "/workspace/my-app/src" }
}
```

### Response（Extension → Backend）— 成功

```json
{
  "jsonrpc": "2.0",
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "result": [
    { "name": "index.ts", "type": "file" },
    { "name": "components", "type": "directory" }
  ]
}
```

### Response（Extension → Backend）— 錯誤

```json
{
  "jsonrpc": "2.0",
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "error": {
    "code": -32002,
    "message": "Path outside project root"
  }
}
```
