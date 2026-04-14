import { homedir } from "os";
import { join } from "path";

const HOME_FOLDER_NAME = ".hooman";

export const basePath = () => {
  return join(homedir(), HOME_FOLDER_NAME);
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
