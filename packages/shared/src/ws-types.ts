import type { FileContent, FilePreview, GitStatus, ChatSession, Bookmark } from './models.js'

// ── WsMessage envelope ──────────────────────────────────────────────

export interface WsMessage<T = unknown> {
  type: string
  id: string
  replyTo?: string
  payload: T
  timestamp: number
}

// ── Error payload ───────────────────────────────────────────────────

export interface ErrorPayload {
  code: ErrorCode
  message: string
}

export type ErrorCode =
  | 'NOT_CONNECTED'
  | 'EXTENSION_OFFLINE'
  | 'TIMEOUT'
  | 'NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'ANNOTATION_BUSY'
  | 'TOUR_RECORDING_EXISTS'
  | 'TOUR_SLUG_EXISTS'
  | 'TOUR_NOT_RECORDING'
  | 'TOUR_STEP_OUT_OF_BOUNDS'
  | 'TOUR_REF_NOT_FOUND'
  | 'TOUR_FILE_NOT_AT_REF'

// ── Message type string literals ────────────────────────────────────

// Connection domain
export const MSG_CONNECTION_WELCOME = 'connection.welcome' as const
export const MSG_CONNECTION_LIST_WORKSPACES = 'connection.listWorkspaces' as const
export const MSG_CONNECTION_LIST_WORKSPACES_RESULT = 'connection.listWorkspaces.result' as const
export const MSG_CONNECTION_SELECT_WORKSPACE = 'connection.selectWorkspace' as const
export const MSG_CONNECTION_SELECT_WORKSPACE_RESULT = 'connection.selectWorkspace.result' as const
export const MSG_CONNECTION_EXTENSION_CONNECTED = 'connection.extensionConnected' as const
export const MSG_CONNECTION_EXTENSION_DISCONNECTED = 'connection.extensionDisconnected' as const

// Workspace domain
export const MSG_WORKSPACE_REGISTER = 'workspace.register' as const
export const MSG_WORKSPACE_REGISTER_RESULT = 'workspace.register.result' as const

// Watch domain
export const MSG_WATCH_SYNC = 'watch.sync' as const
export const MSG_WATCH_SYNC_RESULT = 'watch.sync.result' as const
export const MSG_WATCH_SET = 'watch.set' as const

// File domain
export const MSG_FILE_TREE = 'file.tree' as const
export const MSG_FILE_TREE_RESULT = 'file.tree.result' as const
export const MSG_FILE_READ = 'file.read' as const
export const MSG_FILE_READ_RESULT = 'file.read.result' as const
export const MSG_FILE_PREVIEW = 'file.preview' as const
export const MSG_FILE_PREVIEW_RESULT = 'file.preview.result' as const
export const MSG_FILE_TREE_CHANGED = 'file.treeChanged' as const
export const MSG_FILE_CONTENT_CHANGED = 'file.contentChanged' as const

// Annotation domain
export const MSG_ANNOTATION_GENERATE = 'annotation.generate' as const
export const MSG_ANNOTATION_GENERATE_RESULT = 'annotation.generate.result' as const
export const MSG_ANNOTATION_STATUS = 'annotation.status' as const
export const MSG_ANNOTATION_STATUS_RESULT = 'annotation.status.result' as const
export const MSG_ANNOTATION_CHANGED = 'annotation.changed' as const

// File chat domain
export const MSG_FILE_CHAT_SEND = 'fileChat.send' as const
export const MSG_FILE_CHAT_SEND_RESULT = 'fileChat.send.result' as const
export const MSG_FILE_CHAT_STATUS = 'fileChat.status' as const
export const MSG_FILE_CHAT_STATUS_RESULT = 'fileChat.status.result' as const
export const MSG_FILE_CHAT_THREAD = 'fileChat.thread' as const
export const MSG_FILE_CHAT_THREAD_RESULT = 'fileChat.thread.result' as const
export const MSG_FILE_CHAT_ARCHIVE = 'fileChat.archive' as const
export const MSG_FILE_CHAT_ARCHIVE_RESULT = 'fileChat.archive.result' as const

// LSP domain
export const MSG_LSP_HOVER = 'lsp.hover' as const
export const MSG_LSP_HOVER_RESULT = 'lsp.hover.result' as const
export const MSG_LSP_DEFINITION = 'lsp.definition' as const
export const MSG_LSP_DEFINITION_RESULT = 'lsp.definition.result' as const
export const MSG_LSP_REFERENCES = 'lsp.references' as const
export const MSG_LSP_REFERENCES_RESULT = 'lsp.references.result' as const
export const MSG_LSP_DOCUMENT_SYMBOL = 'lsp.documentSymbol' as const
export const MSG_LSP_DOCUMENT_SYMBOL_RESULT = 'lsp.documentSymbol.result' as const

// Git domain
export const MSG_GIT_STATUS = 'git.status' as const
export const MSG_GIT_STATUS_RESULT = 'git.status.result' as const
export const MSG_GIT_DIFF = 'git.diff' as const
export const MSG_GIT_DIFF_RESULT = 'git.diff.result' as const
export const MSG_GIT_STATUS_CHANGED = 'git.statusChanged' as const

// Chat domain
export const MSG_CHAT_LIST_SESSIONS = 'chat.listSessions' as const
export const MSG_CHAT_LIST_SESSIONS_RESULT = 'chat.listSessions.result' as const
export const MSG_CHAT_GET_HISTORY = 'chat.getHistory' as const
export const MSG_CHAT_GET_HISTORY_RESULT = 'chat.getHistory.result' as const
export const MSG_CHAT_SEND = 'chat.send' as const
export const MSG_CHAT_SEND_RESULT = 'chat.send.result' as const
export const MSG_CHAT_STREAM_CHUNK = 'chat.stream.chunk' as const
export const MSG_CHAT_SESSION_UPDATED = 'chat.sessionUpdated' as const

// Review domain
export const MSG_REVIEW_LIST_PENDING_EDITS = 'review.listPendingEdits' as const
export const MSG_REVIEW_LIST_PENDING_EDITS_RESULT = 'review.listPendingEdits.result' as const
export const MSG_REVIEW_GET_EDIT_DIFF = 'review.getEditDiff' as const
export const MSG_REVIEW_GET_EDIT_DIFF_RESULT = 'review.getEditDiff.result' as const
export const MSG_REVIEW_APPROVE_EDIT = 'review.approveEdit' as const
export const MSG_REVIEW_APPROVE_EDIT_RESULT = 'review.approveEdit.result' as const
export const MSG_REVIEW_REJECT_EDIT = 'review.rejectEdit' as const
export const MSG_REVIEW_REJECT_EDIT_RESULT = 'review.rejectEdit.result' as const
export const MSG_REVIEW_LIST_TOOL_REQUESTS = 'review.listToolRequests' as const
export const MSG_REVIEW_LIST_TOOL_REQUESTS_RESULT = 'review.listToolRequests.result' as const
export const MSG_REVIEW_ACCEPT_TOOL = 'review.acceptTool' as const
export const MSG_REVIEW_ACCEPT_TOOL_RESULT = 'review.acceptTool.result' as const
export const MSG_REVIEW_SKIP_TOOL = 'review.skipTool' as const
export const MSG_REVIEW_SKIP_TOOL_RESULT = 'review.skipTool.result' as const
export const MSG_REVIEW_PENDING_EDITS_CHANGED = 'review.pendingEditsChanged' as const

// Tour domain
export const MSG_TOUR_LIST = 'tour.list' as const
export const MSG_TOUR_LIST_RESULT = 'tour.list.result' as const
export const MSG_TOUR_GET_STEPS = 'tour.getSteps' as const
export const MSG_TOUR_GET_STEPS_RESULT = 'tour.getSteps.result' as const
export const MSG_TOUR_CREATE = 'tour.create' as const
export const MSG_TOUR_CREATE_RESULT = 'tour.create.result' as const
export const MSG_TOUR_ADD_STEP = 'tour.addStep' as const
export const MSG_TOUR_ADD_STEP_RESULT = 'tour.addStep.result' as const
export const MSG_TOUR_DELETE_STEP = 'tour.deleteStep' as const
export const MSG_TOUR_DELETE_STEP_RESULT = 'tour.deleteStep.result' as const
export const MSG_TOUR_FINALIZE = 'tour.finalize' as const
export const MSG_TOUR_FINALIZE_RESULT = 'tour.finalize.result' as const
export const MSG_TOUR_DELETE = 'tour.delete' as const
export const MSG_TOUR_DELETE_RESULT = 'tour.delete.result' as const
export const MSG_TOUR_GET_FILE_AT_REF = 'tour.getFileAtRef' as const
export const MSG_TOUR_GET_FILE_AT_REF_RESULT = 'tour.getFileAtRef.result' as const

export const MSG_TOUR_CREATE_ERROR = 'tour.create.error' as const
export const MSG_TOUR_ADD_STEP_ERROR = 'tour.addStep.error' as const
export const MSG_TOUR_DELETE_STEP_ERROR = 'tour.deleteStep.error' as const
export const MSG_TOUR_FINALIZE_ERROR = 'tour.finalize.error' as const
export const MSG_TOUR_DELETE_ERROR = 'tour.delete.error' as const
export const MSG_TOUR_GET_FILE_AT_REF_ERROR = 'tour.getFileAtRef.error' as const

// Bookmark domain
export const MSG_BOOKMARK_LIST = 'bookmark.list' as const
export const MSG_BOOKMARK_LIST_RESULT = 'bookmark.list.result' as const
export const MSG_BOOKMARK_ADD = 'bookmark.add' as const
export const MSG_BOOKMARK_ADD_RESULT = 'bookmark.add.result' as const
export const MSG_BOOKMARK_REMOVE = 'bookmark.remove' as const
export const MSG_BOOKMARK_REMOVE_RESULT = 'bookmark.remove.result' as const
export const MSG_BOOKMARK_IMPORT = 'bookmark.import' as const
export const MSG_BOOKMARK_IMPORT_RESULT = 'bookmark.import.result' as const
export const MSG_BOOKMARK_CHANGED = 'bookmark.changed' as const

// ── Payload types per message ───────────────────────────────────────

// Connection
export interface ConnectionWelcomePayload {
  backendVersion: string
}

export interface ListWorkspacesResultPayload {
  workspaces: Array<{
    extensionId: string
    workspaceKey: string
    displayName: string
    rootPath: string
    gitBranch: string | null
    extensionVersion: string
    status: 'connected' | 'stale'
  }>
}

export interface SelectWorkspacePayload {
  extensionId: string
}

export interface SelectWorkspaceResultPayload {
  workspace: {
    extensionId: string
    workspaceKey: string
    name: string
    rootPath: string
    gitBranch: string | null
    vscodeVersion: string
    extensionVersion: string
  }
}

export interface ExtensionConnectedPayload {
  extensionId: string
  workspaceKey: string
  displayName: string
  rootPath: string
  extensionVersion: string
}

export interface ExtensionDisconnectedPayload {
  extensionId: string
  reason: 'closed' | 'timeout'
}

// Workspace
export interface WorkspaceRegisterPayload {
  name: string
  rootPath: string
  gitBranch: string | null
  vscodeVersion: string
  extensionVersion: string
}

// Watch
export type WatchDescriptor =
  | {
      topic: 'file.content'
      path: string
    }
  | {
      topic: 'git.status'
      scope: 'workspace'
    }

export interface WatchSyncPayload {
  watches: WatchDescriptor[]
}

export interface WatchSyncResultPayload {
  watches: WatchDescriptor[]
}

export interface WatchSetPayload {
  watches: WatchDescriptor[]
}

// Run/debug event domain
export type RunEventFeature = 'annotation' | 'fileChat'
export type RunEventLevel = 'debug' | 'info' | 'warn' | 'error'

export interface RunEventTarget {
  bindingId?: string
  acquired?: 'reused' | 'spawned'
  paneId?: string
  paneTarget?: string
  pid?: string
  targetScopeKey?: string
}

export interface RunEvent {
  version: 1
  feature: RunEventFeature
  phase: string
  level: RunEventLevel
  timestamp: number
  requestId: string
  generationId?: string
  threadId?: string
  workspaceId?: string
  path?: string
  artifactPath?: string
  threadPath?: string
  runLogPath?: string
  elapsedMs?: number
  target?: RunEventTarget
  diagnostics?: string[]
  error?: {
    message: string
    stack?: string
  }
  data?: Record<string, unknown>
}

// File
export interface FileTreePayload {
  path?: string
}

export interface FileTreeResultPayload {
  root: string
  nodes: import('./models.js').FileTreeNode[]
}

export interface FileReadPayload {
  path: string
}

export type FileReadResultPayload = FileContent

export interface FilePreviewPayload {
  path: string
}

export type FilePreviewResultPayload = FilePreview

export interface FileTreeChangedPayload {
  changes: Array<{
    type: 'created' | 'deleted' | 'changed'
    path: string
  }>
}

export interface FileContentChangedPayload {
  path: string
  isDirty: boolean
}

// Annotation
export interface AnnotationGeneratePayload {
  path: string
  force?: boolean
  generationId?: string
}

export interface AnnotationGenerateResultPayload {
  path: string
  annotationPath: string
  runLogPath?: string
  generationId: string
  submittedAt: number
  target: {
    bindingId: string
    acquired: 'reused' | 'spawned'
    paneId?: string
    paneTarget?: string
    pid?: string
    targetScopeKey?: string
  }
  submitted: true
}

export type AnnotationJobPhase = 'submitted' | 'running' | 'ready' | 'invalid' | 'failed'

export interface AnnotationJobSnapshot {
  path: string
  annotationPath: string
  runLogPath?: string
  generationId: string
  phase: AnnotationJobPhase
  ready: boolean
  submittedAt: number
  updatedAt?: number
  diagnostics?: string[]
  target?: AnnotationGenerateResultPayload['target']
}

export interface AnnotationStatusPayload {
  path: string
  generationId?: string
  minUpdatedAt?: number
}

export type AnnotationArtifactState = 'missing' | 'pending' | 'ready' | 'invalid' | 'stale'

export interface AnnotationArtifactValidation {
  ok: boolean
  diagnostics: string[]
  sourceLineCount?: number
  artifactLineCount?: number
  size?: number
  updatedAt?: number
}

export interface AnnotationStatusResultPayload {
  path: string
  annotationPath: string
  runLogPath?: string
  exists: boolean
  ready: boolean
  state: AnnotationArtifactState
  generationId?: string
  updatedAt?: number
  validation?: AnnotationArtifactValidation
  activeJob?: AnnotationJobSnapshot
}

// File chat
export interface FileChatMarkedLine {
  line: number
  content: string
}

export interface FileChatSendPayload {
  path: string
  question: string
  requestId?: string
  markedLines?: FileChatMarkedLine[]
}

export interface FileChatSendResultPayload {
  path: string
  requestId: string
  threadId: string
  submittedAt: number
  manifestPath: string
  threadPath: string
  runLogPath: string
  target: {
    bindingId: string
    acquired: 'reused' | 'spawned'
    paneId?: string
    paneTarget?: string
    pid?: string
    targetScopeKey?: string
  }
  submitted: true
}

export interface FileChatStatusPayload {
  path: string
  requestId: string
  minUpdatedAt?: number
}

export interface FileChatStatusResultPayload {
  path: string
  requestId: string
  threadId: string
  manifestPath: string
  threadPath: string
  runLogPath: string
  ready: boolean
  state: 'pending' | 'ready' | 'invalid' | 'failed' | 'missing'
  latestAssistantMessage?: string
  diagnostics?: string[]
  updatedAt?: number
}

export interface FileChatThreadPayload {
  threadId?: string
}

export interface FileChatThreadResultPayload {
  threadId: string
  manifestPath: string
  threadPath: string
  runLogPath: string
  threadText: string
  exists: boolean
  updatedAt?: number
}

export interface FileChatArchivePayload {
  threadId?: string
}

export interface FileChatArchiveResultPayload {
  threadId: string
  archivedAt: number
  archivePath: string
  manifestPath: string
  threadPath: string
  runLogPath: string
  previousTargetBindingId?: string
  destroyedTarget?: boolean
  destroyError?: string
}

// LSP
export interface LspPositionPayload {
  path: string
  line: number
  character: number
}

export type LspHoverResultPayload = {
  contents: string
  range?: LspRange
} | null

export interface LspRange {
  start: { line: number; character: number }
  end: { line: number; character: number }
}

export interface LspLocation {
  path: string
  range: LspRange
}

export interface LspDefinitionResultPayload {
  locations: LspLocation[]
}

export interface LspReferencesPayload extends LspPositionPayload {
  includeDeclaration?: boolean
}

export interface LspReferencesResultPayload {
  locations: Array<LspLocation & { preview: string }>
}

export interface LspDocumentSymbolPayload {
  path: string
}

export interface LspDocumentSymbolResultPayload {
  symbols: LspSymbol[]
}

export interface LspSymbol {
  name: string
  kind: string
  range: LspRange
  children?: LspSymbol[]
}

// Git
export type GitStatusResultPayload = GitStatus

export interface GitDiffPayload {
  path: string
}

export interface GitDiffResultPayload {
  path: string
  hunks: import('./models.js').DiffHunk[]
}

export interface GitStatusChangedPayload {
  branch: string
  changedFileCount: number
}

// Chat
export interface ChatGetHistoryPayload {
  sessionId: string
}

export interface ChatGetHistoryResultPayload {
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

export interface ChatSendPayload {
  sessionId?: string
  message: string
  mode?: 'ask' | 'agent' | 'plan'
}

export interface ChatStreamChunkPayload {
  replyTo: string
  chunk: string
  turnId: string
}

export interface ChatSendResultPayload {
  turnId: string
  sessionId: string
  response: string
  model: string
}

export interface ChatSessionUpdatedPayload {
  sessionId: string
  newTurnCount: number
}

export interface ChatListSessionsResultPayload {
  sessions: ChatSession[]
}

// Review
export interface ReviewListPendingEditsResultPayload {
  edits: Array<{
    id: string
    filePath: string
    description?: string
    status: 'pending' | 'approved' | 'rejected'
    createdAt: number
    hunksCount: number
  }>
}

export interface ReviewGetEditDiffPayload {
  editId: string
}

export interface ReviewGetEditDiffResultPayload {
  id: string
  diff: import('./models.js').FileDiff
}

export interface ReviewEditActionPayload {
  editId: string
}

export interface ReviewListToolRequestsResultPayload {
  requests: Array<{
    id: string
    toolName: string
    parameters: Record<string, unknown>
    description: string
    status: 'pending' | 'accepted' | 'skipped'
    createdAt: number
  }>
}

export interface ReviewToolActionPayload {
  requestId: string
}

export interface ReviewPendingEditsChangedPayload {
  pendingEditCount: number
  toolRequestCount: number
}

// Tour
export type TourListSortKey = 'createdAt'
export type TourListSortDirection = 'asc' | 'desc'

export interface TourListPayload {
  sort?: {
    key?: TourListSortKey
    direction?: TourListSortDirection
  }
}

export interface TourListResultPayload {
  tours: Array<{
    id: string
    title: string
    description?: string
    stepCount: number
    createdAt: number
    ref?: string
    status?: 'recording'
  }>
}

export interface TourGetStepsPayload {
  tourId: string
}

export interface TourGetStepsResultPayload {
  tour: {
    id: string
    title: string
    description?: string
    ref?: string
  }
  steps: Array<{
    file: string
    line: number
    endLine?: number
    title?: string
    description: string
    selection?: { start: { line: number; character: number }; end: { line: number; character: number } }
  }>
}

export interface TourCreatePayload { title: string; ref?: string }
export interface TourCreateResultPayload { tourId: string; filePath: string }
export interface TourAddStepPayload {
  tourId: string
  file?: string
  line?: number
  endLine?: number
  selection?: { start: { line: number; character: number }; end: { line: number; character: number } }
  title?: string
  description: string
  index?: number
}
export interface TourAddStepResultPayload { stepCount: number }
export interface TourDeleteStepPayload { tourId: string; stepIndex: number }
export interface TourDeleteStepResultPayload { stepCount: number }
export interface TourFinalizePayload { tourId: string }
export interface TourFinalizeResultPayload { ok: true }
export interface TourDeletePayload { tourId: string }
export interface TourDeleteResultPayload { ok: true }
export interface TourGetFileAtRefPayload { ref: string | null; path: string }
export interface TourGetFileAtRefResultPayload { content: string; languageId: string; ref: string | null }

// Bookmark
export interface BookmarkListPayload { workspaceKey: string }
export interface BookmarkListResultPayload { bookmarks: Bookmark[] }
export interface BookmarkAddPayload { workspaceKey: string; path: string; line?: number; preview: string }
export interface BookmarkAddResultPayload { bookmark: Bookmark }
export interface BookmarkRemovePayload { workspaceKey: string; bookmarkId: string }
export interface BookmarkRemoveResultPayload { ok: true }
export interface BookmarkImportPayload { workspaceKey: string; bookmarks: Array<{ path: string; line?: number; preview: string; createdAt?: number }> }
export interface BookmarkImportResultPayload { bookmarks: Bookmark[] }
export interface BookmarkChangedPayload { workspaceKey: string; bookmarks: Bookmark[] }
