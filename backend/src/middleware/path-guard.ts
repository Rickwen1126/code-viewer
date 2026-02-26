import { resolve, normalize, sep } from "node:path";
import { createMiddleware } from "hono/factory";
import { PATH_OUTSIDE_ROOT } from "@code-viewer/protocol";
import type { Project } from "@code-viewer/protocol";
import { getConfig } from "../config.js";

export class PathGuardError extends Error {
  readonly code = PATH_OUTSIDE_ROOT;
  constructor(message = "Path outside project root") {
    super(message);
    this.name = "PathGuardError";
  }
}

export function validatePath(rootPath: string, requestedPath: string): string {
  if (requestedPath.includes("\0")) {
    throw new PathGuardError("Invalid path: contains null bytes");
  }

  const absolutePath = resolve(rootPath, requestedPath);
  const normalizedRoot = normalize(rootPath);
  const normalizedPath = normalize(absolutePath);

  if (
    normalizedPath !== normalizedRoot &&
    !normalizedPath.startsWith(normalizedRoot + sep)
  ) {
    throw new PathGuardError();
  }

  return absolutePath;
}

type PathGuardEnv = {
  Variables: {
    project: Project;
    absolutePath: string;
    relativePath: string;
  };
};

export const pathGuard = createMiddleware<PathGuardEnv>(async (c, next) => {
  const projectId = c.req.param("projectId");
  const requestedPath = c.req.query("path") ?? "";

  const config = getConfig();
  const project = config.projects.find((p) => p.id === projectId);

  if (!project) {
    return c.json(
      { error: { code: -32000, message: "Project not found" } },
      404,
    );
  }

  try {
    const absolutePath = validatePath(project.rootPath, requestedPath);
    c.set("project", project);
    c.set("absolutePath", absolutePath);
    c.set("relativePath", requestedPath);
    await next();
  } catch (e) {
    if (e instanceof PathGuardError) {
      return c.json({ error: { code: e.code, message: e.message } }, 400);
    }
    throw e;
  }
});
