import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { WORKSPACE_ROOT } from "../env.js";

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

/** Directory for inbound channel attachments: attachments/inbound/<source>/<messageId>. */
export function getInboundAttachmentDir(
  source: "slack" | "whatsapp",
  messageId: string,
): string {
  const dir = join(
    getWorkspaceAttachmentsDir(),
    source,
    messageId.replace(/[/\\]/g, "_"),
  );
  return dir;
}

/** Write an inbound attachment to disk; returns absolute path. Creates dir if needed. */
export function writeInboundAttachment(
  source: "slack" | "whatsapp",
  messageId: string,
  filename: string,
  buffer: Buffer,
): string {
  const dir = getInboundAttachmentDir(source, messageId);
  mkdirSync(dir, { recursive: true });
  const safeName = filename.replace(/[/\\]/g, "_").trim() || "file";
  const path = join(dir, safeName);
  writeFileSync(path, buffer);
  return path;
}
