import { homedir } from "os";
import { join } from "path";
import { projectPath } from "./project-registry.js";

export const APP_FOLDER = ".hooman";
const HOOMAN_HOME_ENV = "HOOMAN_HOME";

export const basePath = () => {
  const override = process.env[HOOMAN_HOME_ENV]?.trim();
  if (override) {
    return override;
  }

  return join(homedir(), APP_FOLDER);
};

export const configJsonPath = () => join(basePath(), "config.json");

export const instructionsMdPath = () => join(basePath(), "instructions.md");

export const mcpJsonPath = () => join(basePath(), "mcp.json");

export const mcpOauthJsonPath = () => join(basePath(), "mcp-oauth.json");

export const allowlistJsonPath = () => join(basePath(), "allowlist.json");

// Per-project storage: scoped to the current working directory's project via a
// UUID registry (see ./project-registry.ts), so sessions, memory, attachments,
// and plans do not bleed across unrelated projects.
export const sessionsPath = () => join(projectPath(), "sessions");

export const memoryPath = () => join(projectPath(), "memory");

export const offloadedContentPath = () =>
  join(projectPath(), "offloaded-content");

export const attachmentsPath = () => join(projectPath(), "attachments");

export const plansPath = () => join(projectPath(), "plans");

export const skillsPath = () => join(basePath(), "skills");

export const cachePath = () => join(basePath(), "cache");

export const binPath = () => join(basePath(), "bin");

export const ripgrepPath = () =>
  join(binPath(), process.platform === "win32" ? "rg.exe" : "rg");
