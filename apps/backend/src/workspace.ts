import { join } from "path";
import { WORKSPACE_ROOT } from "./env.js";

export { WORKSPACE_ROOT };
export const WORKSPACE_MCPCWD = join(WORKSPACE_ROOT, "mcpcwd");

export function getWorkspaceDbPath(): string {
  return join(WORKSPACE_ROOT, "hooman.db");
}

export function getWorkspaceConfigPath(): string {
  return join(WORKSPACE_ROOT, "config.json");
}

export function getWorkspaceAttachmentsDir(): string {
  return join(WORKSPACE_ROOT, "attachments");
}
