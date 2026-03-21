// ── File ────────────────────────────────────────────────────────────

export interface FileTreeNode {
  path: string
  name: string
  type: 'file' | 'directory'
  size?: number
  isGitIgnored: boolean
  isDirty: boolean
  children?: FileTreeNode[]
  languageId?: string
}

export interface FileContent {
  path: string
  content: string
  languageId: string
  isDirty: boolean
  encoding: string
  lineCount: number
}

// ── Git ─────────────────────────────────────────────────────────────

export interface GitStatus {
  branch: string
  ahead: number
  behind: number
  changedFiles: ChangedFile[]
}

export interface ChangedFile {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed'
  oldPath?: string
  insertions: number
  deletions: number
}

export interface FileDiff {
  path: string
  hunks: DiffHunk[]
}

export interface DiffHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  changes: DiffChange[]
}

export interface DiffChange {
  type: 'add' | 'delete' | 'normal'
  content: string
  oldLineNumber?: number
  newLineNumber?: number
}

// ── Chat ────────────────────────────────────────────────────────────

export interface ChatSession {
  id: string
  title: string
  createdAt: number
  lastActiveAt: number
  turnCount: number
  mode: 'ask' | 'agent' | 'plan'
}

export interface ChatTurn {
  id: string
  sessionId: string
  request: string
  response: string
  responseStatus: 'complete' | 'streaming' | 'error'
  model?: string
  timestamp: number
}

// ── Review ──────────────────────────────────────────────────────────

export interface PendingEdit {
  id: string
  filePath: string
  diff: FileDiff
  description?: string
  status: 'pending' | 'approved' | 'rejected'
  createdAt: number
}

export interface ToolRequest {
  id: string
  toolName: string
  parameters: Record<string, unknown>
  description: string
  status: 'pending' | 'accepted' | 'skipped'
  createdAt: number
}

// ── Tour ────────────────────────────────────────────────────────────

export interface CodeTour {
  id: string
  title: string
  description?: string
  steps: TourStep[]
  stepCount: number
}

export interface TourStep {
  file: string
  line: number
  endLine?: number
  title?: string
  description: string
}

// ── Connection ──────────────────────────────────────────────────────

export interface Workspace {
  extensionId: string
  name: string
  rootPath: string
  gitBranch: string | null
  vscodeVersion: string
}

export interface ExtensionConnection {
  id: string
  displayName: string
  rootPath: string
  connectedAt: number
  lastHeartbeat: number
  status: 'connected' | 'stale'
}

export interface FrontendSession {
  id: string
  selectedExtensionId: string | null
  connectedAt: number
}
