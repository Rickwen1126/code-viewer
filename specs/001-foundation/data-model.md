# 資料模型：Foundation

## 實體定義

### Project（專案）

| 欄位 | 類型 | 說明 |
|------|------|------|
| id | string | 唯一識別碼（自動生成或設定檔指定） |
| name | string | 顯示名稱 |
| rootPath | string | 專案根目錄的絕對路徑（Docker container 內） |

**來源**：Server 端設定檔（JSON）
**限制**：所有檔案 API 操作 MUST 驗證路徑在某個 Project 的 rootPath 之下

### FileNode（檔案節點）

| 欄位 | 類型 | 說明 |
|------|------|------|
| name | string | 檔案或資料夾名稱 |
| path | string | 相對於 project root 的路徑 |
| type | "file" \| "directory" | 節點類型 |
| size | number \| null | 檔案大小（bytes），資料夾為 null |
| children | FileNode[] \| null | 子節點（僅資料夾，lazy load 時為 null） |

**載入策略**：Lazy — 只載入當前展開的目錄層級

### FileContent（檔案內容）

| 欄位 | 類型 | 說明 |
|------|------|------|
| path | string | 相對於 project root 的路徑 |
| content | string | 文字內容（超過 5MB 截斷至前 1000 行） |
| language | string | 語言識別碼（用於 Shiki，如 "typescript"） |
| size | number | 原始檔案大小（bytes） |
| truncated | boolean | 是否因超過閾值而截斷 |
| isBinary | boolean | 是否為二進位檔案 |

**二進位偵測**：檢查前 8192 bytes 是否包含 null byte

### BridgeStatus（橋接狀態）

| 值 | 說明 |
|------|------|
| connected | Extension WebSocket 已連線，LSP 可用 |
| disconnected | Extension 未連線，使用 fallback 模式 |
| warming_up | Extension 已連線但 Language Server 尚未就緒 |

**狀態轉換**：
```
disconnected → connected    # Extension WebSocket 建立
connected → warming_up      # 開啟新 workspace folder，LSP 重新載入
warming_up → connected      # LSP 首次查詢成功
connected → disconnected    # WebSocket 斷線
warming_up → disconnected   # WebSocket 斷線
```

### ServerConfig（伺服器設定）

| 欄位 | 類型 | 說明 |
|------|------|------|
| projects | Project[] | 可存取的專案列表 |
| codeServerUrl | string | code-server 內部網址（Docker 內網） |
| port | number | Backend 監聽埠號 |

**來源**：`config.json`（Docker volume mount）

## 共享型別：JSON-RPC 2.0 Protocol

### BridgeRequest（Backend → Extension）

| 欄位 | 類型 | 說明 |
|------|------|------|
| jsonrpc | "2.0" | 協定版本 |
| id | string | UUID，用於 response 配對 |
| method | string | 方法名稱，如 "fs/readDirectory" |
| params | unknown | 方法參數 |

### BridgeResponse（Extension → Backend）

| 欄位 | 類型 | 說明 |
|------|------|------|
| jsonrpc | "2.0" | 協定版本 |
| id | string | 對應 request 的 UUID |
| result | unknown \| undefined | 成功時的回傳值 |
| error | BridgeError \| undefined | 失敗時的錯誤資訊 |

### BridgeError

| 欄位 | 類型 | 說明 |
|------|------|------|
| code | number | 錯誤碼（JSON-RPC 標準 + 自訂） |
| message | string | 人類可讀的錯誤訊息 |
| data | unknown \| undefined | 額外錯誤資料 |

### 自訂錯誤碼

| 碼 | 常數名 | 說明 |
|----|--------|------|
| -32000 | WORKSPACE_NOT_OPEN | 指定的 workspace folder 尚未開啟 |
| -32001 | LSP_UNAVAILABLE | Language Server 尚未就緒（warming up） |
| -32002 | PATH_OUTSIDE_ROOT | 路徑超出允許的 project directory 範圍 |
| -32003 | FILE_TOO_LARGE | 檔案超過大小閾值 |
| -32004 | BINARY_FILE | 嘗試讀取二進位檔案的文字內容 |
