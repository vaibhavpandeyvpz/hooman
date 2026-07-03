import { homedir } from "os";
import { join } from "path";

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

export const sessionsPath = () => join(basePath(), "sessions");

export const memoryPath = () => join(basePath(), "memory");

export const attachmentsPath = () => join(basePath(), "attachments");

export const plansPath = () => join(basePath(), "plans");

export const skillsPath = () => join(basePath(), "skills");

export const cachePath = () => join(basePath(), "cache");

export const binPath = () => join(basePath(), "bin");

export const ripgrepPath = () =>
  join(binPath(), process.platform === "win32" ? "rg.exe" : "rg");
