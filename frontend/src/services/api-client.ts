import type {
  Project,
  FileNode,
  FileContent,
  BridgeStatus,
} from "@code-viewer/protocol";

const BASE_URL = "/api";

export class ApiError extends Error {
  constructor(
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
  const json = await res.json();

  if (json.error) {
    throw new ApiError(json.error.code, json.error.message);
  }

  return json.data;
}

export const apiClient = {
  getProjects(): Promise<Project[]> {
    return fetchJson("/projects");
  },

  getFiles(projectId: string, path = ""): Promise<FileNode[]> {
    return fetchJson(
      `/projects/${projectId}/files?path=${encodeURIComponent(path)}`,
    );
  },

  getFile(projectId: string, path: string): Promise<FileContent> {
    return fetchJson(
      `/projects/${projectId}/file?path=${encodeURIComponent(path)}`,
    );
  },

  getStatus(): Promise<{ bridge: BridgeStatus; version: string }> {
    return fetchJson("/status");
  },
};
