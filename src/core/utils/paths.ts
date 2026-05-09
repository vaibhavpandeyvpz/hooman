import { homedir } from "os";
import { join } from "path";

const APP_FOLDER = ".hooman";
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

export const sessionsPath = () => join(basePath(), "sessions");

export const attachmentsPath = () => join(basePath(), "attachments");

export const plansPath = () => join(basePath(), "plans");

export const skillsPath = () => join(basePath(), "skills");

export const wikiPath = () => join(basePath(), "wiki");

export const wikiDbPath = () => join(wikiPath(), "content.sqlite");

export const memoryDbPath = () => join(basePath(), "memory.sqlite");

export const modelsCachePath = () => join(basePath(), ".models");
