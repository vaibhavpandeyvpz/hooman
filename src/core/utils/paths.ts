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

export const attachmentsPath = () => {
  return join(basePath(), "attachments");
};

export const plansPath = () => {
  return join(basePath(), "plans");
};

export const skillsPath = () => {
  return join(basePath(), "skills");
};
