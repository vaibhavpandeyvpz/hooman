import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const APP_FOLDER = ".hooman";

export const basePath = () => {
  const local = join(process.cwd(), APP_FOLDER);
  if (existsSync(local)) {
    return local;
  }
  return join(homedir(), APP_FOLDER);
};

export const configJsonPath = () => {
  return join(basePath(), "config.json");
};

export const instructionsMdPath = () => {
  return join(basePath(), "instructions.md");
};

export const mcpJsonPath = () => {
  return join(basePath(), "mcp.json");
};

export const sessionsPath = () => {
  return join(basePath(), "sessions");
};

export const skillsPath = () => {
  return join(basePath(), "skills");
};
