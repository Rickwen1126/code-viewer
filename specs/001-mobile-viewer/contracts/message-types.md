# WebSocket Message Types: Mobile Code Viewer

**Branch**: `001-mobile-viewer` | **Date**: 2026-03-14
**Input**: [ws-protocol.md](./ws-protocol.md), [data-model.md](../data-model.md)

---

## Connection Domain

### `connection.welcome`
**Direction**: Backend → Extension / Frontend
**Trigger**: WS 連線建立後立即發送

```typescript
{ backendVersion: string }
```

### `connection.listWorkspaces`
**Direction**: Frontend → Backend
**Response**: `connection.listWorkspaces.result`

```typescript
// Request payload
{}

// Response payload
{
  workspaces: Array<{
    extensionId: string
    displayName: string
    rootPath: string
    gitBranch: string | null
    status: 'connected' | 'stale'
  }>
}
```

### `connection.selectWorkspace`
**Direction**: Frontend → Backend
**Response**: `connection.selectWorkspace.result`

```typescript
// Request payload
{ extensionId: string }

// Response payload
{
  workspace: {
    extensionId: string
    name: string
    rootPath: string
    gitBranch: string | null
    vscodeVersion: string
  }
}
```

### `connection.extensionConnected`
**Direction**: Backend → Frontend (event)
**Trigger**: 新 Extension 連線時

```typescript
{
  extensionId: string
  displayName: string
  rootPath: string
}
```

### `connection.extensionDisconnected`
**Direction**: Backend → Frontend (event)
**Trigger**: Extension 斷線時

```typescript
{
  extensionId: string
  reason: 'closed' | 'timeout'
}
```

---

## Workspace Domain

### `workspace.register`
**Direction**: Extension → Backend
**Response**: `workspace.register.result`

```typescript
// Request payload
{
  name: string
  rootPath: string
  gitBranch: string | null
  vscodeVersion: string
}

// Response payload
{ ok: true }
```

### `workspace.info`
**Direction**: Frontend → Backend → Extension
**Response**: `workspace.info.result`
**Cache**: Backend 快取 5 分鐘

```typescript
// Request payload
{}

// Response payload
{
  name: string
  rootPath: string
  gitBranch: string | null
  vscodeVersion: string
  extensionCount: number
}
```

---

## File Domain

### `file.tree`
**Direction**: Frontend → Backend → Extension
**Response**: `file.tree.result`
**Cache**: Backend 快取 5 分鐘

```typescript
// Request payload
{ path?: string }  // 預設 workspace root

// Response payload
{
  root: string
  nodes: FileTreeNode[]
}
```

### `file.read`
**Direction**: Frontend → Backend → Extension
**Response**: `file.read.result`

```typescript
// Request payload
{ path: string }

// Response payload
{
  path: string
  content: string
  languageId: string
  isDirty: boolean
  encoding: string
  lineCount: number
}
```

### `file.treeChanged`
**Direction**: Extension → Backend → Frontend (event)
**Trigger**: 檔案樹發生變化（新增/刪除/重新命名）

```typescript
{
  changes: Array<{
    type: 'created' | 'deleted' | 'changed'
    path: string
  }>
}
```

### `file.contentChanged`
**Direction**: Extension → Backend → Frontend (event)
**Trigger**: 已開啟的檔案內容變化（dirty buffer 更新）

```typescript
{
  path: string
  isDirty: boolean
}
```

---

## LSP Domain

### `lsp.hover`
**Direction**: Frontend → Backend → Extension
**Response**: `lsp.hover.result`

```typescript
// Request payload
{
  path: string
  line: number      // 0-based
  character: number  // 0-based
}

// Response payload
{
  contents: string   // Markdown 格式的 hover 資訊
  range?: {
    start: { line: number, character: number }
    end: { line: number, character: number }
  }
} | null  // null = 無 hover 資訊
```

### `lsp.definition`
**Direction**: Frontend → Backend → Extension
**Response**: `lsp.definition.result`

```typescript
// Request payload
{
  path: string
  line: number
  character: number
}

// Response payload
{
  locations: Array<{
    path: string
    range: {
      start: { line: number, character: number }
      end: { line: number, character: number }
    }
  }>
}
```

### `lsp.references`
**Direction**: Frontend → Backend → Extension
**Response**: `lsp.references.result`

```typescript
// Request payload
{
  path: string
  line: number
  character: number
  includeDeclaration?: boolean
}

// Response payload
{
  locations: Array<{
    path: string
    range: {
      start: { line: number, character: number }
      end: { line: number, character: number }
    }
    preview: string  // 該行的文字預覽
  }>
}
```

### `lsp.documentSymbol`
**Direction**: Frontend → Backend → Extension
**Response**: `lsp.documentSymbol.result`

```typescript
// Request payload
{ path: string }

// Response payload
{
  symbols: Array<{
    name: string
    kind: string     // 'class' | 'function' | 'variable' | 'interface' | 'enum' | ...
    range: {
      start: { line: number, character: number }
      end: { line: number, character: number }
    }
    children?: Array</* 遞迴同結構 */>
  }>
}
```

---

## Git Domain

### `git.status`
**Direction**: Frontend → Backend → Extension
**Response**: `git.status.result`

```typescript
// Request payload
{}

// Response payload
{
  branch: string
  ahead: number
  behind: number
  changedFiles: Array<{
    path: string
    status: 'added' | 'modified' | 'deleted' | 'renamed'
    oldPath?: string
    insertions: number
    deletions: number
  }>
}
```

### `git.diff`
**Direction**: Frontend → Backend → Extension
**Response**: `git.diff.result`

```typescript
// Request payload
{ path: string }

// Response payload
{
  path: string
  hunks: Array<{
    oldStart: number
    oldLines: number
    newStart: number
    newLines: number
    changes: Array<{
      type: 'add' | 'delete' | 'normal'
      content: string
      oldLineNumber?: number
      newLineNumber?: number
    }>
  }>
}
```

### `git.statusChanged`
**Direction**: Extension → Backend → Frontend (event)
**Trigger**: Git 狀態改變（branch 切換、檔案 stage/unstage）

```typescript
{
  branch: string
  changedFileCount: number
}
```

---

## Chat Domain

### `chat.listSessions`
**Direction**: Frontend → Backend → Extension
**Response**: `chat.listSessions.result`

```typescript
// Request payload
{}

// Response payload
{
  sessions: Array<{
    id: string
    title: string
    createdAt: number
    lastActiveAt: number
    turnCount: number
    mode: 'ask' | 'agent' | 'plan'
  }>
}
```

### `chat.getHistory`
**Direction**: Frontend → Backend → Extension
**Response**: `chat.getHistory.result`

```typescript
// Request payload
{ sessionId: string }

// Response payload
{
  session: {
    id: string
    title: string
    mode: 'ask' | 'agent' | 'plan'
  }
  turns: Array<{
    id: string
    request: string
    response: string
    model?: string
    timestamp: number
  }>
}
```

### `chat.send`
**Direction**: Frontend → Backend → Extension
**Response**: `chat.send.result`（完成時）
**Streaming**: `chat.stream.chunk`（逐字推送）

```typescript
// Request payload
{
  sessionId?: string    // 既有 session 追問；null = 新 session
  message: string
  mode?: 'ask' | 'agent'
}

// Stream chunk (event, N 次)
{
  replyTo: string      // 原始 chat.send 的 id
  chunk: string        // 文字片段
  turnId: string       // Turn ID
}

// Response payload (完成)
{
  turnId: string
  sessionId: string
  response: string     // 完整回答
  model: string
}
```

### `chat.sessionUpdated`
**Direction**: Extension → Backend → Frontend (event)
**Trigger**: Desktop 端 Copilot Chat 有新活動

```typescript
{
  sessionId: string
  newTurnCount: number
}
```

---

## Review Domain

### `review.listPendingEdits`
**Direction**: Frontend → Backend → Extension
**Response**: `review.listPendingEdits.result`

```typescript
// Request payload
{}

// Response payload
{
  edits: Array<{
    id: string
    filePath: string
    description?: string
    status: 'pending' | 'approved' | 'rejected'
    createdAt: number
    hunksCount: number
  }>
}
```

### `review.getEditDiff`
**Direction**: Frontend → Backend → Extension
**Response**: `review.getEditDiff.result`

```typescript
// Request payload
{ editId: string }

// Response payload
{
  id: string
  diff: FileDiff  // 同 git.diff 的 hunks 結構（FileDiff.path 即為檔案路徑）
}
```

### `review.approveEdit`
**Direction**: Frontend → Backend → Extension
**Response**: `review.approveEdit.result`

```typescript
// Request payload
{ editId: string }

// Response payload
{ ok: true }
```

### `review.rejectEdit`
**Direction**: Frontend → Backend → Extension
**Response**: `review.rejectEdit.result`

```typescript
// Request payload
{ editId: string }

// Response payload
{ ok: true }
```

### `review.listToolRequests`
**Direction**: Frontend → Backend → Extension
**Response**: `review.listToolRequests.result`

```typescript
// Request payload
{}

// Response payload
{
  requests: Array<{
    id: string
    toolName: string
    parameters: Record<string, unknown>
    description: string
    status: 'pending' | 'accepted' | 'skipped'
    createdAt: number
  }>
}
```

### `review.acceptTool`
**Direction**: Frontend → Backend → Extension
**Response**: `review.acceptTool.result`

```typescript
// Request payload
{ requestId: string }

// Response payload
{ ok: true }
```

### `review.skipTool`
**Direction**: Frontend → Backend → Extension
**Response**: `review.skipTool.result`

```typescript
// Request payload
{ requestId: string }

// Response payload
{ ok: true }
```

### `review.pendingEditsChanged`
**Direction**: Extension → Backend → Frontend (event)
**Trigger**: 新的 pending edit 或 tool request

```typescript
{
  pendingEditCount: number
  toolRequestCount: number
}
```

---

## Tour Domain

### `tour.list`
**Direction**: Frontend → Backend → Extension
**Response**: `tour.list.result`

```typescript
// Request payload
{}

// Response payload
{
  tours: Array<{
    id: string
    title: string
    description?: string
    stepCount: number
  }>
}
```

### `tour.getSteps`
**Direction**: Frontend → Backend → Extension
**Response**: `tour.getSteps.result`

```typescript
// Request payload
{ tourId: string }

// Response payload
{
  tour: {
    id: string
    title: string
    description?: string
  }
  steps: Array<{
    file: string
    line: number
    endLine?: number
    title?: string
    description: string
  }>
}
```

---

## 訊息類型完整清單

| Type | Direction | Pattern | Domain |
|------|-----------|---------|--------|
| `connection.welcome` | B→E/F | Event | Connection |
| `connection.listWorkspaces` | F→B | Req/Res | Connection |
| `connection.selectWorkspace` | F→B | Req/Res | Connection |
| `connection.extensionConnected` | B→F | Event | Connection |
| `connection.extensionDisconnected` | B→F | Event | Connection |
| `workspace.register` | E→B | Req/Res | Workspace |
| `workspace.info` | F→B→E | Req/Res | Workspace |
| `file.tree` | F→B→E | Req/Res | File |
| `file.read` | F→B→E | Req/Res | File |
| `file.treeChanged` | E→B→F | Event | File |
| `file.contentChanged` | E→B→F | Event | File |
| `lsp.hover` | F→B→E | Req/Res | LSP |
| `lsp.definition` | F→B→E | Req/Res | LSP |
| `lsp.references` | F→B→E | Req/Res | LSP |
| `lsp.documentSymbol` | F→B→E | Req/Res | LSP |
| `git.status` | F→B→E | Req/Res | Git |
| `git.diff` | F→B→E | Req/Res | Git |
| `git.statusChanged` | E→B→F | Event | Git |
| `chat.listSessions` | F→B→E | Req/Res | Chat |
| `chat.getHistory` | F→B→E | Req/Res | Chat |
| `chat.send` | F→B→E | Req/Res+Stream | Chat |
| `chat.stream.chunk` | E→B→F | Event | Chat |
| `chat.sessionUpdated` | E→B→F | Event | Chat |
| `review.listPendingEdits` | F→B→E | Req/Res | Review |
| `review.getEditDiff` | F→B→E | Req/Res | Review |
| `review.approveEdit` | F→B→E | Req/Res | Review |
| `review.rejectEdit` | F→B→E | Req/Res | Review |
| `review.listToolRequests` | F→B→E | Req/Res | Review |
| `review.acceptTool` | F→B→E | Req/Res | Review |
| `review.skipTool` | F→B→E | Req/Res | Review |
| `review.pendingEditsChanged` | E→B→F | Event | Review |
| `tour.list` | F→B→E | Req/Res | Tour |
| `tour.getSteps` | F→B→E | Req/Res | Tour |

**Legend**: B=Backend, E=Extension, F=Frontend
