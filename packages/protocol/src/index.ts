// ============================================================
// @code-viewer/protocol — JSON-RPC 2.0 shared types
// ============================================================

// --- JSON-RPC 2.0 base types ---

export interface BridgeRequest {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params?: unknown;
}

export interface BridgeResponse {
  jsonrpc: "2.0";
  id: string;
  result?: unknown;
  error?: BridgeError;
}

export interface BridgeError {
  code: number;
  message: string;
  data?: unknown;
}

// --- Custom error codes ---

export const WORKSPACE_NOT_OPEN = -32000;
export const LSP_UNAVAILABLE = -32001;
export const PATH_OUTSIDE_ROOT = -32002;
export const FILE_TOO_LARGE = -32003;
export const BINARY_FILE = -32004;

// --- Entity types ---

export interface Project {
  id: string;
  name: string;
  rootPath: string;
}

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number | null;
}

export interface FileContent {
  path: string;
  content: string | null;
  language: string | null;
  size: number;
  truncated: boolean;
  isBinary: boolean;
}

export type BridgeStatus = "connected" | "disconnected" | "warming_up";

export interface ServerConfig {
  projects: Project[];
  codeServerUrl: string;
  port: number;
}

// --- WS method params / result types ---

export interface FsReadDirectoryParams {
  path: string;
}

export interface FsReadDirectoryEntry {
  name: string;
  type: "file" | "directory";
}

export interface FsReadFileParams {
  path: string;
}

export interface FsReadFileResult {
  content: string;
  size: number;
}

export interface FsStatParams {
  path: string;
}

export interface FsStatResult {
  type: "file" | "directory";
  size: number;
  mtime: number;
}

export interface WorkspaceFolderParams {
  path: string;
}

export interface WorkspaceFolderResult {
  success: boolean;
}

// --- Method name constants ---

export const METHODS = {
  FS_READ_DIRECTORY: "fs/readDirectory",
  FS_READ_FILE: "fs/readFile",
  FS_STAT: "fs/stat",
  WORKSPACE_ADD_FOLDER: "workspace/addFolder",
  WORKSPACE_REMOVE_FOLDER: "workspace/removeFolder",
} as const;

// --- Type-safe method map ---

export interface MethodMap {
  "fs/readDirectory": {
    params: FsReadDirectoryParams;
    result: FsReadDirectoryEntry[];
  };
  "fs/readFile": {
    params: FsReadFileParams;
    result: FsReadFileResult;
  };
  "fs/stat": {
    params: FsStatParams;
    result: FsStatResult;
  };
  "workspace/addFolder": {
    params: WorkspaceFolderParams;
    result: WorkspaceFolderResult;
  };
  "workspace/removeFolder": {
    params: WorkspaceFolderParams;
    result: WorkspaceFolderResult;
  };
}

export type MethodName = keyof MethodMap;

// --- REST API response wrappers ---

export interface ApiResponse<T> {
  data: T;
}

export interface ApiErrorResponse {
  error: BridgeError;
}
