# REST API Contract：Foundation

Base URL: `/api`
Content-Type: `application/json`

## 專案

### GET /api/projects

列出所有可用專案。

**Response 200**:
```json
{
  "data": [
    { "id": "proj-1", "name": "my-app", "rootPath": "/workspace/my-app" }
  ]
}
```

## 檔案系統

### GET /api/projects/:projectId/files?path=

列出指定路徑的目錄內容（一層）。

**Query Parameters**:
- `path`（optional）：相對於 project root 的路徑，預設 `""`（root）

**Response 200**:
```json
{
  "data": [
    { "name": "src", "path": "src", "type": "directory", "size": null },
    { "name": "package.json", "path": "package.json", "type": "file", "size": 1234 }
  ]
}
```

**Response 400** — 路徑超出 project root：
```json
{
  "error": { "code": -32002, "message": "Path outside project root" }
}
```

### GET /api/projects/:projectId/file?path=

讀取指定檔案內容。

**Query Parameters**:
- `path`（required）：相對於 project root 的檔案路徑

**Response 200**:
```json
{
  "data": {
    "path": "src/index.ts",
    "content": "import { Hono } from 'hono'...",
    "language": "typescript",
    "size": 2048,
    "truncated": false,
    "isBinary": false
  }
}
```

**Response 200** — 截斷的大檔案：
```json
{
  "data": {
    "path": "logs/app.log",
    "content": "... (前 1000 行)",
    "language": "log",
    "size": 10485760,
    "truncated": true,
    "isBinary": false
  }
}
```

**Response 200** — 二進位檔案：
```json
{
  "data": {
    "path": "assets/logo.png",
    "content": null,
    "language": null,
    "size": 45678,
    "truncated": false,
    "isBinary": true
  }
}
```

## 系統狀態

### GET /api/status

取得系統狀態，包含 code-server bridge 連線狀態。

**Response 200**:
```json
{
  "data": {
    "bridge": "connected",
    "version": "0.1.0"
  }
}
```

`bridge` 值：`"connected"` | `"disconnected"` | `"warming_up"`

## 錯誤格式

所有 API 錯誤統一格式：

```json
{
  "error": {
    "code": -32002,
    "message": "Path outside project root"
  }
}
```
