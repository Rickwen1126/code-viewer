import { readFileSync, accessSync } from "node:fs";
import { resolve } from "node:path";
import type { ServerConfig, Project } from "@code-viewer/protocol";

let config: ServerConfig | null = null;

export function loadConfig(configPath?: string): ServerConfig {
  const filePath =
    configPath ??
    process.env.CONFIG_PATH ??
    resolve(process.cwd(), "config.json");

  const raw = JSON.parse(readFileSync(filePath, "utf-8"));

  const projects: Project[] = (raw.projects ?? []).map(
    (p: { id: string; name: string; rootPath: string }) => ({
      id: p.id,
      name: p.name,
      rootPath: p.rootPath,
    }),
  );

  for (const project of projects) {
    try {
      accessSync(project.rootPath);
    } catch {
      console.warn(
        `Warning: project "${project.name}" rootPath does not exist: ${project.rootPath}`,
      );
    }
  }

  config = {
    projects,
    codeServerUrl:
      process.env.CODE_SERVER_URL ??
      raw.codeServerUrl ??
      "http://localhost:8080",
    port: raw.port ?? Number(process.env.PORT) ?? 3000,
  };

  console.log(
    `Config loaded: ${config.projects.length} project(s), port ${config.port}`,
  );
  return config;
}

export function getConfig(): ServerConfig {
  if (!config) throw new Error("Config not loaded. Call loadConfig() first.");
  return config;
}
