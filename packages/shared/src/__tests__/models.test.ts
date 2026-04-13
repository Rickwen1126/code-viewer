import { describe, it, expect } from 'vitest'
import {
  MSG_FILE_TREE,
  MSG_FILE_READ,
  MSG_FILE_READ_RESULT,
  MSG_FILE_PREVIEW,
  MSG_FILE_PREVIEW_RESULT,
  MSG_FILE_TREE_RESULT,
  MSG_FILE_TREE_CHANGED,
  MSG_FILE_CONTENT_CHANGED,
  MSG_LSP_HOVER,
  MSG_LSP_HOVER_RESULT,
  MSG_LSP_DEFINITION,
  MSG_LSP_DEFINITION_RESULT,
  MSG_LSP_REFERENCES,
  MSG_LSP_REFERENCES_RESULT,
  MSG_LSP_DOCUMENT_SYMBOL,
  MSG_LSP_DOCUMENT_SYMBOL_RESULT,
  MSG_CONNECTION_WELCOME,
  MSG_CONNECTION_LIST_WORKSPACES,
  MSG_CONNECTION_LIST_WORKSPACES_RESULT,
  MSG_CONNECTION_SELECT_WORKSPACE,
  MSG_CONNECTION_SELECT_WORKSPACE_RESULT,
  MSG_CONNECTION_EXTENSION_CONNECTED,
  MSG_CONNECTION_EXTENSION_DISCONNECTED,
  MSG_WORKSPACE_REGISTER,
  MSG_WORKSPACE_REGISTER_RESULT,
  MSG_WATCH_SYNC,
  MSG_WATCH_SYNC_RESULT,
  MSG_WATCH_SET,
  MSG_GIT_STATUS,
  MSG_GIT_STATUS_RESULT,
  MSG_GIT_DIFF,
  MSG_GIT_DIFF_RESULT,
  MSG_GIT_STATUS_CHANGED,
  MSG_CHAT_SEND,
  MSG_CHAT_SEND_RESULT,
  MSG_CHAT_LIST_SESSIONS,
  MSG_CHAT_LIST_SESSIONS_RESULT,
  MSG_CHAT_GET_HISTORY,
  MSG_CHAT_GET_HISTORY_RESULT,
  MSG_CHAT_STREAM_CHUNK,
  MSG_CHAT_SESSION_UPDATED,
  MSG_REVIEW_LIST_PENDING_EDITS,
  MSG_REVIEW_LIST_PENDING_EDITS_RESULT,
  MSG_REVIEW_GET_EDIT_DIFF,
  MSG_REVIEW_GET_EDIT_DIFF_RESULT,
  MSG_REVIEW_APPROVE_EDIT,
  MSG_REVIEW_APPROVE_EDIT_RESULT,
  MSG_REVIEW_REJECT_EDIT,
  MSG_REVIEW_REJECT_EDIT_RESULT,
  MSG_TOUR_LIST,
  MSG_TOUR_LIST_RESULT,
  MSG_TOUR_GET_STEPS,
  MSG_TOUR_GET_STEPS_RESULT,
  type WsMessage,
  type ErrorPayload,
  type ErrorCode,
} from '../ws-types.js'
import type {
  FileTreeNode,
  FileContent,
  FilePreview,
  GitStatus,
  ChangedFile,
  FileDiff,
  DiffHunk,
  DiffChange,
  ChatSession,
  ChatTurn,
  PendingEdit,
  ToolRequest,
  CodeTour,
  TourStep,
  Workspace,
  ExtensionConnection,
  FrontendSession,
} from '../models.js'

// ── WsMessage ────────────────────────────────────────────────────────

describe('WsMessage', () => {
  it('should roundtrip through JSON serialization', () => {
    const msg: WsMessage<{ path: string }> = {
      type: 'file.read',
      id: 'test-id',
      payload: { path: 'src/index.ts' },
      timestamp: Date.now(),
    }
    const json = JSON.stringify(msg)
    const parsed = JSON.parse(json) as WsMessage<{ path: string }>
    expect(parsed.type).toBe('file.read')
    expect(parsed.id).toBe('test-id')
    expect(parsed.payload.path).toBe('src/index.ts')
    expect(parsed.replyTo).toBeUndefined()
  })

  it('should include replyTo when set', () => {
    const msg: WsMessage = {
      type: 'file.read.result',
      id: 'resp-1',
      replyTo: 'req-1',
      payload: {},
      timestamp: Date.now(),
    }
    expect(msg.replyTo).toBe('req-1')
    const json = JSON.stringify(msg)
    const parsed = JSON.parse(json) as WsMessage
    expect(parsed.replyTo).toBe('req-1')
  })

  it('should preserve timestamp through JSON roundtrip', () => {
    const ts = 1700000000000
    const msg: WsMessage<null> = {
      type: 'connection.welcome',
      id: 'id-ts',
      payload: null,
      timestamp: ts,
    }
    const parsed = JSON.parse(JSON.stringify(msg)) as WsMessage<null>
    expect(parsed.timestamp).toBe(ts)
  })

  it('should support complex payload types', () => {
    const msg: WsMessage<{ files: string[]; count: number }> = {
      type: 'file.tree.result',
      id: 'tree-1',
      payload: { files: ['a.ts', 'b.ts'], count: 2 },
      timestamp: Date.now(),
    }
    const parsed = JSON.parse(JSON.stringify(msg)) as WsMessage<{ files: string[]; count: number }>
    expect(parsed.payload.files).toHaveLength(2)
    expect(parsed.payload.count).toBe(2)
  })

  it('should allow payload to be undefined/empty object', () => {
    const msg: WsMessage<Record<string, never>> = {
      type: 'git.status',
      id: 'git-1',
      payload: {},
      timestamp: Date.now(),
    }
    expect(msg.payload).toEqual({})
  })
})

// ── ErrorPayload ─────────────────────────────────────────────────────

describe('ErrorPayload', () => {
  it('should have code and message fields', () => {
    const err: ErrorPayload = {
      code: 'NOT_FOUND',
      message: 'File not found',
    }
    expect(err.code).toBe('NOT_FOUND')
    expect(err.message).toBe('File not found')
  })

  it('should accept all ErrorCode values', () => {
    const codes: ErrorCode[] = [
      'NOT_CONNECTED',
      'EXTENSION_OFFLINE',
      'TIMEOUT',
      'NOT_FOUND',
      'INVALID_REQUEST',
    ]
    for (const code of codes) {
      const err: ErrorPayload = { code, message: `error: ${code}` }
      expect(err.code).toBe(code)
    }
  })
})

// ── Message type constants ───────────────────────────────────────────

describe('message type constants — connection domain', () => {
  it('should have correct string values', () => {
    expect(MSG_CONNECTION_WELCOME).toBe('connection.welcome')
    expect(MSG_CONNECTION_LIST_WORKSPACES).toBe('connection.listWorkspaces')
    expect(MSG_CONNECTION_LIST_WORKSPACES_RESULT).toBe('connection.listWorkspaces.result')
    expect(MSG_CONNECTION_SELECT_WORKSPACE).toBe('connection.selectWorkspace')
    expect(MSG_CONNECTION_SELECT_WORKSPACE_RESULT).toBe('connection.selectWorkspace.result')
    expect(MSG_CONNECTION_EXTENSION_CONNECTED).toBe('connection.extensionConnected')
    expect(MSG_CONNECTION_EXTENSION_DISCONNECTED).toBe('connection.extensionDisconnected')
  })
})

describe('message type constants — workspace domain', () => {
  it('should have correct string values', () => {
    expect(MSG_WORKSPACE_REGISTER).toBe('workspace.register')
    expect(MSG_WORKSPACE_REGISTER_RESULT).toBe('workspace.register.result')
  })
})

describe('message type constants — watch domain', () => {
  it('should have correct string values', () => {
    expect(MSG_WATCH_SYNC).toBe('watch.sync')
    expect(MSG_WATCH_SYNC_RESULT).toBe('watch.sync.result')
    expect(MSG_WATCH_SET).toBe('watch.set')
  })
})

describe('message type constants — file domain', () => {
  it('should have correct string values', () => {
    expect(MSG_FILE_TREE).toBe('file.tree')
    expect(MSG_FILE_TREE_RESULT).toBe('file.tree.result')
    expect(MSG_FILE_READ).toBe('file.read')
    expect(MSG_FILE_READ_RESULT).toBe('file.read.result')
    expect(MSG_FILE_PREVIEW).toBe('file.preview')
    expect(MSG_FILE_PREVIEW_RESULT).toBe('file.preview.result')
    expect(MSG_FILE_TREE_CHANGED).toBe('file.treeChanged')
    expect(MSG_FILE_CONTENT_CHANGED).toBe('file.contentChanged')
  })
})

describe('message type constants — LSP domain', () => {
  it('should have correct string values', () => {
    expect(MSG_LSP_HOVER).toBe('lsp.hover')
    expect(MSG_LSP_HOVER_RESULT).toBe('lsp.hover.result')
    expect(MSG_LSP_DEFINITION).toBe('lsp.definition')
    expect(MSG_LSP_DEFINITION_RESULT).toBe('lsp.definition.result')
    expect(MSG_LSP_REFERENCES).toBe('lsp.references')
    expect(MSG_LSP_REFERENCES_RESULT).toBe('lsp.references.result')
    expect(MSG_LSP_DOCUMENT_SYMBOL).toBe('lsp.documentSymbol')
    expect(MSG_LSP_DOCUMENT_SYMBOL_RESULT).toBe('lsp.documentSymbol.result')
  })
})

describe('message type constants — git domain', () => {
  it('should have correct string values', () => {
    expect(MSG_GIT_STATUS).toBe('git.status')
    expect(MSG_GIT_STATUS_RESULT).toBe('git.status.result')
    expect(MSG_GIT_DIFF).toBe('git.diff')
    expect(MSG_GIT_DIFF_RESULT).toBe('git.diff.result')
    expect(MSG_GIT_STATUS_CHANGED).toBe('git.statusChanged')
  })
})

describe('message type constants — chat domain', () => {
  it('should have correct string values', () => {
    expect(MSG_CHAT_SEND).toBe('chat.send')
    expect(MSG_CHAT_SEND_RESULT).toBe('chat.send.result')
    expect(MSG_CHAT_LIST_SESSIONS).toBe('chat.listSessions')
    expect(MSG_CHAT_LIST_SESSIONS_RESULT).toBe('chat.listSessions.result')
    expect(MSG_CHAT_GET_HISTORY).toBe('chat.getHistory')
    expect(MSG_CHAT_GET_HISTORY_RESULT).toBe('chat.getHistory.result')
    expect(MSG_CHAT_STREAM_CHUNK).toBe('chat.stream.chunk')
    expect(MSG_CHAT_SESSION_UPDATED).toBe('chat.sessionUpdated')
  })
})

describe('message type constants — review domain', () => {
  it('should have correct string values', () => {
    expect(MSG_REVIEW_LIST_PENDING_EDITS).toBe('review.listPendingEdits')
    expect(MSG_REVIEW_LIST_PENDING_EDITS_RESULT).toBe('review.listPendingEdits.result')
    expect(MSG_REVIEW_GET_EDIT_DIFF).toBe('review.getEditDiff')
    expect(MSG_REVIEW_GET_EDIT_DIFF_RESULT).toBe('review.getEditDiff.result')
    expect(MSG_REVIEW_APPROVE_EDIT).toBe('review.approveEdit')
    expect(MSG_REVIEW_APPROVE_EDIT_RESULT).toBe('review.approveEdit.result')
    expect(MSG_REVIEW_REJECT_EDIT).toBe('review.rejectEdit')
    expect(MSG_REVIEW_REJECT_EDIT_RESULT).toBe('review.rejectEdit.result')
  })
})

describe('message type constants — tour domain', () => {
  it('should have correct string values', () => {
    expect(MSG_TOUR_LIST).toBe('tour.list')
    expect(MSG_TOUR_LIST_RESULT).toBe('tour.list.result')
    expect(MSG_TOUR_GET_STEPS).toBe('tour.getSteps')
    expect(MSG_TOUR_GET_STEPS_RESULT).toBe('tour.getSteps.result')
  })
})

// ── Data model shapes ────────────────────────────────────────────────

describe('FileTreeNode', () => {
  it('should have all required fields', () => {
    const node: FileTreeNode = {
      path: 'src/index.ts',
      name: 'index.ts',
      type: 'file',
      isGitIgnored: false,
      isDirty: false,
    }
    expect(node.path).toBe('src/index.ts')
    expect(node.name).toBe('index.ts')
    expect(node.type).toBe('file')
    expect(node.isGitIgnored).toBe(false)
    expect(node.isDirty).toBe(false)
    expect(node.children).toBeUndefined()
    expect(node.size).toBeUndefined()
    expect(node.languageId).toBeUndefined()
  })

  it('should support directory type with children', () => {
    const child: FileTreeNode = {
      path: 'src/index.ts',
      name: 'index.ts',
      type: 'file',
      isGitIgnored: false,
      isDirty: true,
      languageId: 'typescript',
    }
    const dir: FileTreeNode = {
      path: 'src',
      name: 'src',
      type: 'directory',
      isGitIgnored: false,
      isDirty: false,
      children: [child],
    }
    expect(dir.type).toBe('directory')
    expect(dir.children).toHaveLength(1)
    expect(dir.children![0].name).toBe('index.ts')
  })

  it('should support optional size field', () => {
    const node: FileTreeNode = {
      path: 'large.bin',
      name: 'large.bin',
      type: 'file',
      size: 102400,
      isGitIgnored: false,
      isDirty: false,
    }
    expect(node.size).toBe(102400)
  })
})

describe('FileContent', () => {
  it('should have all required fields', () => {
    const content: FileContent = {
      path: 'src/app.ts',
      content: 'export default {}',
      languageId: 'typescript',
      isDirty: false,
      encoding: 'utf8',
      lineCount: 1,
    }
    expect(content.path).toBe('src/app.ts')
    expect(content.languageId).toBe('typescript')
    expect(content.lineCount).toBe(1)
    expect(content.encoding).toBe('utf8')
  })
})

describe('FilePreview', () => {
  it('should have all required fields', () => {
    const preview: FilePreview = {
      path: 'assets/logo.png',
      kind: 'image',
      mimeType: 'image/png',
      encoding: 'base64',
      data: 'Zm9v',
      size: 3,
    }
    expect(preview.kind).toBe('image')
    expect(preview.mimeType).toBe('image/png')
    expect(preview.encoding).toBe('base64')
  })
})

describe('GitStatus', () => {
  it('should have all required fields', () => {
    const status: GitStatus = {
      branch: 'main',
      commitHash: 'abc1234',
      ahead: 2,
      behind: 0,
      changedFiles: [],
    }
    expect(status.branch).toBe('main')
    expect(status.ahead).toBe(2)
    expect(status.behind).toBe(0)
    expect(status.changedFiles).toHaveLength(0)
  })

  it('should support changed files', () => {
    const file: ChangedFile = {
      path: 'src/app.ts',
      status: 'modified',
      insertions: 5,
      deletions: 2,
    }
    const status: GitStatus = {
      branch: 'feature/x',
      commitHash: 'abc1234',
      ahead: 1,
      behind: 0,
      changedFiles: [file],
    }
    expect(status.changedFiles[0].status).toBe('modified')
    expect(status.changedFiles[0].insertions).toBe(5)
  })

  it('should support renamed files with oldPath', () => {
    const file: ChangedFile = {
      path: 'src/new-name.ts',
      status: 'renamed',
      oldPath: 'src/old-name.ts',
      insertions: 0,
      deletions: 0,
    }
    expect(file.oldPath).toBe('src/old-name.ts')
    expect(file.status).toBe('renamed')
  })

  it('should support all status values', () => {
    const statuses: ChangedFile['status'][] = ['added', 'modified', 'deleted', 'renamed']
    for (const s of statuses) {
      const f: ChangedFile = { path: 'f.ts', status: s, insertions: 0, deletions: 0 }
      expect(f.status).toBe(s)
    }
  })
})

describe('FileDiff and DiffHunk', () => {
  it('should create a valid FileDiff', () => {
    const change: DiffChange = {
      type: 'add',
      content: 'new line',
      newLineNumber: 1,
    }
    const hunk: DiffHunk = {
      oldStart: 1,
      oldLines: 0,
      newStart: 1,
      newLines: 1,
      changes: [change],
    }
    const diff: FileDiff = {
      path: 'src/app.ts',
      hunks: [hunk],
    }
    expect(diff.path).toBe('src/app.ts')
    expect(diff.hunks).toHaveLength(1)
    expect(diff.hunks[0].changes[0].type).toBe('add')
    expect(diff.hunks[0].changes[0].content).toBe('new line')
  })

  it('should support all DiffChange types', () => {
    const add: DiffChange = { type: 'add', content: '+line', newLineNumber: 5 }
    const del: DiffChange = { type: 'delete', content: '-line', oldLineNumber: 3 }
    const norm: DiffChange = { type: 'normal', content: ' line', oldLineNumber: 4, newLineNumber: 4 }
    expect(add.type).toBe('add')
    expect(del.type).toBe('delete')
    expect(norm.type).toBe('normal')
    expect(norm.oldLineNumber).toBe(4)
    expect(norm.newLineNumber).toBe(4)
  })
})

describe('ChatSession', () => {
  it('should have all required fields', () => {
    const session: ChatSession = {
      id: 'sess-1',
      title: 'My Session',
      createdAt: 1700000000000,
      lastActiveAt: 1700000100000,
      turnCount: 3,
      mode: 'ask',
    }
    expect(session.id).toBe('sess-1')
    expect(session.title).toBe('My Session')
    expect(session.mode).toBe('ask')
    expect(session.turnCount).toBe(3)
  })

  it('should support all mode values', () => {
    const modes: ChatSession['mode'][] = ['ask', 'agent', 'plan']
    for (const mode of modes) {
      const s: ChatSession = { id: 'x', title: 'x', createdAt: 0, lastActiveAt: 0, turnCount: 0, mode }
      expect(s.mode).toBe(mode)
    }
  })
})

describe('ChatTurn', () => {
  it('should have all required fields', () => {
    const turn: ChatTurn = {
      id: 'turn-1',
      sessionId: 'sess-1',
      request: 'What is TypeScript?',
      response: 'TypeScript is a superset of JavaScript.',
      responseStatus: 'complete',
      timestamp: 1700000000000,
    }
    expect(turn.responseStatus).toBe('complete')
    expect(turn.model).toBeUndefined()
  })

  it('should support streaming and error status', () => {
    const statuses: ChatTurn['responseStatus'][] = ['complete', 'streaming', 'error']
    for (const s of statuses) {
      const t: ChatTurn = { id: 'x', sessionId: 'y', request: 'q', response: '', responseStatus: s, timestamp: 0 }
      expect(t.responseStatus).toBe(s)
    }
  })
})

describe('PendingEdit', () => {
  it('should have all required fields', () => {
    const edit: PendingEdit = {
      id: 'edit-1',
      filePath: 'src/app.ts',
      diff: { path: 'src/app.ts', hunks: [] },
      status: 'pending',
      createdAt: 1700000000000,
    }
    expect(edit.id).toBe('edit-1')
    expect(edit.status).toBe('pending')
    expect(edit.description).toBeUndefined()
  })

  it('should support all status values', () => {
    const statuses: PendingEdit['status'][] = ['pending', 'approved', 'rejected']
    for (const s of statuses) {
      const e: PendingEdit = { id: 'x', filePath: 'f.ts', diff: { path: 'f.ts', hunks: [] }, status: s, createdAt: 0 }
      expect(e.status).toBe(s)
    }
  })
})

describe('ToolRequest', () => {
  it('should have all required fields', () => {
    const req: ToolRequest = {
      id: 'tool-1',
      toolName: 'read_file',
      parameters: { path: 'src/app.ts' },
      description: 'Read a file',
      status: 'pending',
      createdAt: 1700000000000,
    }
    expect(req.toolName).toBe('read_file')
    expect(req.parameters).toEqual({ path: 'src/app.ts' })
    expect(req.status).toBe('pending')
  })

  it('should support all status values', () => {
    const statuses: ToolRequest['status'][] = ['pending', 'accepted', 'skipped']
    for (const s of statuses) {
      const r: ToolRequest = { id: 'x', toolName: 't', parameters: {}, description: 'd', status: s, createdAt: 0 }
      expect(r.status).toBe(s)
    }
  })
})

describe('CodeTour and TourStep', () => {
  it('should create a valid CodeTour with steps', () => {
    const step: TourStep = {
      file: 'src/app.ts',
      line: 10,
      description: 'This is the entry point',
    }
    const tour: CodeTour = {
      id: 'tour-1',
      title: 'Getting Started',
      steps: [step],
      stepCount: 1,
    }
    expect(tour.id).toBe('tour-1')
    expect(tour.steps).toHaveLength(1)
    expect(tour.description).toBeUndefined()
    expect(step.endLine).toBeUndefined()
    expect(step.title).toBeUndefined()
  })

  it('should support optional step fields', () => {
    const step: TourStep = {
      file: 'src/app.ts',
      line: 5,
      endLine: 15,
      title: 'Key function',
      description: 'Handles initialization',
    }
    expect(step.endLine).toBe(15)
    expect(step.title).toBe('Key function')
  })
})

describe('Workspace', () => {
  it('should have all required fields', () => {
    const ws: Workspace = {
      extensionId: 'ext-123',
      workspaceKey: 'ws_project',
      name: 'My Project',
      rootPath: '/home/user/project',
      gitBranch: 'main',
      vscodeVersion: '1.100.0',
      extensionVersion: '0.0.4',
    }
    expect(ws.extensionId).toBe('ext-123')
    expect(ws.gitBranch).toBe('main')
    expect(ws.extensionVersion).toBe('0.0.4')
  })

  it('should allow null gitBranch', () => {
    const ws: Workspace = {
      extensionId: 'ext-456',
      workspaceKey: 'ws_nogit',
      name: 'No Git',
      rootPath: '/tmp/project',
      gitBranch: null,
      vscodeVersion: '1.100.0',
      extensionVersion: '0.0.4',
    }
    expect(ws.gitBranch).toBeNull()
  })
})

describe('ExtensionConnection', () => {
  it('should have all required fields', () => {
    const conn: ExtensionConnection = {
      id: 'conn-1',
      displayName: 'My Workspace',
      rootPath: '/home/user/project',
      connectedAt: 1700000000000,
      lastHeartbeat: 1700000050000,
      status: 'connected',
    }
    expect(conn.status).toBe('connected')
    expect(conn.lastHeartbeat).toBe(1700000050000)
  })

  it('should support stale status', () => {
    const conn: ExtensionConnection = {
      id: 'conn-2',
      displayName: 'Stale',
      rootPath: '/tmp',
      connectedAt: 1700000000000,
      lastHeartbeat: 1700000000000,
      status: 'stale',
    }
    expect(conn.status).toBe('stale')
  })
})

describe('FrontendSession', () => {
  it('should have all required fields', () => {
    const session: FrontendSession = {
      id: 'fs-1',
      selectedExtensionId: 'ext-123',
      connectedAt: 1700000000000,
    }
    expect(session.selectedExtensionId).toBe('ext-123')
  })

  it('should allow null selectedExtensionId', () => {
    const session: FrontendSession = {
      id: 'fs-2',
      selectedExtensionId: null,
      connectedAt: 1700000000000,
    }
    expect(session.selectedExtensionId).toBeNull()
  })
})
