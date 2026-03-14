# Data Model: Mobile Code Viewer

**Branch**: `001-mobile-viewer` | **Date**: 2026-03-14
**Input**: [spec.md](./spec.md), [research.md](./research.md)

---

## 實體關係圖

```
ExtensionConnection 1──────1 Workspace
       │                      │
       │                      ├── 1──N FileTreeNode
       │                      ├── 1──N ChatSession ──── 1──N ChatTurn
       │                      ├── 1──N PendingEdit
       │                      ├── 1──N ToolRequest
       │                      ├── 1──N CodeTour ──── 1──N TourStep
       │                      └── 1──1 GitStatus ──── 1──N ChangedFile
       │
FrontendSession ──────────1 Workspace (selected, mutable)
```

> **備註**：一個 VS Code 視窗 = 一個 Extension 實體 = 一個 Workspace = 一條 WS 連線（spec 假設）。
> FrontendSession 的 selected workspace 可隨時切換（FR-006）。

---

## 核心實體

### ExtensionConnection

Backend 管理的 VS Code Extension WS 連線。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | `string` | 唯一識別碼（由 Extension 產生，format: `{machineName}-{pid}`）|
| `displayName` | `string` | 顯示名稱（VS Code window title）|
| `rootPath` | `string` | workspace 根目錄的絕對路徑 |
| `connectedAt` | `number` | 連線建立 timestamp（ms） |
| `lastHeartbeat` | `number` | 最後一次 heartbeat timestamp |
| `status` | `'connected' \| 'stale'` | 連線狀態 |

**State Transitions**:
```
[ws open] → connected
connected + (no pong 40s) → stale
stale + (reconnect / new ws open) → connected
stale + (5 min no reconnect) → removed from map
[ws close] → removed from map
```

### Workspace

Extension 回報的 workspace 資訊。一個 Extension 對應一個 Workspace（1:1）。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `extensionId` | `string` | 對應的 ExtensionConnection ID |
| `name` | `string` | workspace 名稱（通常是目錄名） |
| `rootPath` | `string` | workspace 根目錄路徑 |
| `gitBranch` | `string \| null` | 目前 Git branch 名稱 |
| `vscodeVersion` | `string` | VS Code 版本 |

### FileTreeNode

檔案樹節點，由 Extension 透過 `workspace.fs` 讀取後傳送。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `path` | `string` | 相對於 workspace root 的路徑 |
| `name` | `string` | 檔案/目錄名稱 |
| `type` | `'file' \| 'directory'` | 節點類型 |
| `size` | `number \| undefined` | 檔案大小（bytes），目錄為 undefined |
| `isGitIgnored` | `boolean` | 是否被 .gitignore 忽略 |
| `isDirty` | `boolean` | 是否有未存檔修改 |
| `children` | `FileTreeNode[] \| undefined` | 子節點（僅目錄） |
| `languageId` | `string \| undefined` | VS Code 語言識別碼（`typescript`, `json` 等） |

### FileContent

檔案內容，按需載入（使用者點選時）。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `path` | `string` | 檔案路徑 |
| `content` | `string` | 檔案文字內容 |
| `languageId` | `string` | 語言識別碼 |
| `isDirty` | `boolean` | 是否為 dirty buffer |
| `encoding` | `string` | 編碼（通常 `utf-8`） |
| `lineCount` | `number` | 行數 |

### GitStatus

workspace 的 Git 狀態。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `branch` | `string` | 目前 branch 名稱 |
| `ahead` | `number` | 領先 remote 的 commit 數 |
| `behind` | `number` | 落後 remote 的 commit 數 |
| `changedFiles` | `ChangedFile[]` | 修改檔案列表 |

### ChangedFile

Git 變更的檔案。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `path` | `string` | 檔案路徑 |
| `status` | `'added' \| 'modified' \| 'deleted' \| 'renamed'` | 變更類型 |
| `oldPath` | `string \| undefined` | 重新命名前的路徑 |
| `insertions` | `number` | 新增行數 |
| `deletions` | `number` | 刪除行數 |

### FileDiff

檔案的行級 diff 資料。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `path` | `string` | 檔案路徑 |
| `hunks` | `DiffHunk[]` | Diff hunks |

### DiffHunk

一個 diff hunk（連續修改區段）。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `oldStart` | `number` | 舊檔案起始行 |
| `oldLines` | `number` | 舊檔案行數 |
| `newStart` | `number` | 新檔案起始行 |
| `newLines` | `number` | 新檔案行數 |
| `changes` | `DiffChange[]` | 變更明細 |

### DiffChange

一行 diff 變更。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `type` | `'add' \| 'delete' \| 'normal'` | 行變更類型 |
| `content` | `string` | 行內容 |
| `oldLineNumber` | `number \| undefined` | 舊檔案行號 |
| `newLineNumber` | `number \| undefined` | 新檔案行號 |

### ChatSession

Copilot Chat 對話 session。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | `string` | Session 唯一識別碼 |
| `title` | `string` | Session 標題（通常取自第一個問題） |
| `createdAt` | `number` | 建立 timestamp |
| `lastActiveAt` | `number` | 最後活動 timestamp |
| `turnCount` | `number` | 對話 turn 數 |
| `mode` | `'ask' \| 'agent' \| 'plan'` | Chat 模式 |

### ChatTurn

一個對話 turn（一問一答）。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | `string` | Turn 唯一識別碼 |
| `sessionId` | `string` | 所屬 session ID |
| `request` | `string` | 使用者訊息 |
| `response` | `string` | Copilot 回答（Markdown 格式） |
| `responseStatus` | `'complete' \| 'streaming' \| 'error'` | 回答狀態（Frontend local state，不在 WS 訊息中傳輸）|
| `model` | `string \| undefined` | 使用的模型名稱 |
| `timestamp` | `number` | Timestamp |

### PendingEdit

Copilot 產生的待審查程式碼修改。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | `string` | 唯一識別碼 |
| `filePath` | `string` | 目標檔案路徑 |
| `diff` | `FileDiff` | Diff 內容（重用 FileDiff 結構）|
| `description` | `string \| undefined` | 修改說明 |
| `status` | `'pending' \| 'approved' \| 'rejected'` | 審查狀態 |
| `createdAt` | `number` | 建立 timestamp |

### ToolRequest

Copilot 的工具使用請求。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | `string` | 唯一識別碼 |
| `toolName` | `string` | 工具名稱（如 `writeFile`, `runCommand`）|
| `parameters` | `Record<string, unknown>` | 工具參數 |
| `description` | `string` | 人類可讀的操作描述 |
| `status` | `'pending' \| 'accepted' \| 'skipped'` | 處理狀態 |
| `createdAt` | `number` | 建立 timestamp |

### FrontendSession

Backend 管理的 Mobile Frontend WS 連線。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | `string` | 連線 ID（Backend 自動產生，UUID v4）|
| `selectedExtensionId` | `string \| null` | 目前選擇的 Extension ID（`connection.selectWorkspace` 後設定）|
| `connectedAt` | `number` | 連線建立 timestamp（ms） |

> **備註**：Frontend 可隨時透過 `connection.selectWorkspace` 切換 selectedExtensionId。
> 未選擇 workspace 時，所有 relay 類請求回傳 `NOT_CONNECTED` error。

---

### CodeTour

CodeTour 定義（對應 `.tours/*.tour` JSON 檔案）。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | `string` | Tour ID（通常為檔案名） |
| `title` | `string` | Tour 標題 |
| `description` | `string \| undefined` | Tour 說明 |
| `steps` | `TourStep[]` | 步驟列表 |
| `stepCount` | `number` | 總步驟數 |

> **備註**：Tour 完成進度（FR-071）為 Frontend local state，
> 儲存在 localStorage（key: `tour-progress:{extensionId}:{tourId}` → `{ currentStep: number }`）。

### TourStep

CodeTour 的一個步驟。

| 欄位 | 型別 | 說明 |
|------|------|------|
| `file` | `string` | 對應檔案路徑 |
| `line` | `number` | 起始行號 |
| `endLine` | `number \| undefined` | 結束行號（range highlight）|
| `title` | `string \| undefined` | 步驟標題 |
| `description` | `string` | 說明文字（Markdown）|

---

## Frontend 快取模型

Frontend 使用 IndexedDB 做離線快取：

| Store | Key | Value | TTL |
|-------|-----|-------|-----|
| `file-tree` | `{extensionId}` | `FileTreeNode[]` | 無（下次連線覆蓋）|
| `file-content` | `{extensionId}:{path}` | `FileContent` | 24h |
| `chat-sessions` | `{extensionId}:{sessionId}` | `ChatSession + ChatTurn[]` | 無 |
| `git-status` | `{extensionId}` | `GitStatus` | 無（下次連線覆蓋）|

**快取策略**：
- 連線時：從 Extension 同步最新資料，同時更新快取
- 離線時：讀取快取，UI 顯示離線狀態
- 快取失效：file-content 24h 過期，其他在下次連線時覆蓋

---

## Backend 記憶體狀態

Backend 不使用持久化儲存，所有狀態在記憶體中：

```typescript
// 連線管理
extensions: Map<string, { ws: WebSocket, workspace: Workspace }>
frontends: Map<string, { ws: WebSocket, selectedExtensionId: string | null }>

// 快取（減少重複請求 Extension）
fileTreeCache: Map<string, { data: FileTreeNode[], updatedAt: number }>       // TTL 5min
workspaceInfoCache: Map<string, { data: WorkspaceInfo, updatedAt: number }>   // TTL 5min
```

**記憶體清理**：
- Extension 斷線 → 移除對應 entry + fileTreeCache
- Frontend 斷線 → 移除對應 entry
- fileTreeCache / workspaceInfoCache 有 5 分鐘 TTL，過期重新向 Extension 請求
- Extension stale 超過 5 分鐘未重連 → 移除對應 entry + 所有快取
