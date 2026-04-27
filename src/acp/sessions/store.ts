import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SessionInfo } from "@agentclientprotocol/sdk";
import type { MessageData } from "@strands-agents/sdk";
import type { NamedMcpTransport } from "../../core/mcp/config.js";

export type SessionMetaFile = {
  cwd: string;
  createdAt: string;
  updatedAt: string;
  title?: string | null;
  /** Logical user from ACP client `_meta` (see `extractAcpClientUserId`). */
  userId?: string | null;
  /** Session-level system prompt from ACP client `_meta`. */
  systemPrompt?: string | null;
  /** Session-scoped MCP servers requested by the ACP client. */
  mcpServers?: NamedMcpTransport[];
};

const META = "meta.json";
const MESSAGES = "messages.json";

export function sessionDir(root: string, sessionId: string): string {
  return join(root, sessionId);
}

export async function writeSessionMeta(
  root: string,
  sessionId: string,
  meta: SessionMetaFile,
): Promise<void> {
  const dir = sessionDir(root, sessionId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, META),
    `${JSON.stringify(meta, null, 2)}\n`,
    "utf8",
  );
  const msgPath = join(dir, MESSAGES);
  try {
    await readFile(msgPath);
  } catch {
    await writeFile(msgPath, "[]\n", "utf8");
  }
}

export async function updateSessionMeta(
  root: string,
  sessionId: string,
  patch: Partial<Pick<SessionMetaFile, "title" | "updatedAt">>,
): Promise<void> {
  const dir = sessionDir(root, sessionId);
  const cur = await readSessionMeta(root, sessionId);
  if (!cur) {
    return;
  }
  const next: SessionMetaFile = {
    ...cur,
    ...patch,
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
  };
  await writeFile(
    join(dir, META),
    `${JSON.stringify(next, null, 2)}\n`,
    "utf8",
  );
}

export async function patchSessionMeta(
  root: string,
  sessionId: string,
  patch: Partial<SessionMetaFile>,
): Promise<void> {
  const cur = await readSessionMeta(root, sessionId);
  if (!cur) {
    return;
  }
  const next: SessionMetaFile = {
    ...cur,
    ...patch,
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
  };
  await writeFile(
    join(sessionDir(root, sessionId), META),
    `${JSON.stringify(next, null, 2)}\n`,
    "utf8",
  );
}

export async function readSessionMeta(
  root: string,
  sessionId: string,
): Promise<SessionMetaFile | null> {
  try {
    const raw = await readFile(join(sessionDir(root, sessionId), META), "utf8");
    return JSON.parse(raw) as SessionMetaFile;
  } catch {
    return null;
  }
}

export async function saveSessionMessages(
  root: string,
  sessionId: string,
  messages: MessageData[],
): Promise<void> {
  const dir = sessionDir(root, sessionId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, MESSAGES),
    `${JSON.stringify(messages, null, 2)}\n`,
    "utf8",
  );
  await updateSessionMeta(root, sessionId, {
    updatedAt: new Date().toISOString(),
  });
}

export async function loadSessionMessages(
  root: string,
  sessionId: string,
): Promise<MessageData[]> {
  try {
    const raw = await readFile(
      join(sessionDir(root, sessionId), MESSAGES),
      "utf8",
    );
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) {
      return [];
    }
    return data as MessageData[];
  } catch {
    return [];
  }
}

export async function listStoredSessionIds(root: string): Promise<string[]> {
  try {
    const names = await readdir(root, { withFileTypes: true });
    return names.filter((d) => d.isDirectory()).map((d) => d.name);
  } catch {
    return [];
  }
}

export async function toSessionInfo(
  root: string,
  sessionId: string,
): Promise<SessionInfo | null> {
  const meta = await readSessionMeta(root, sessionId);
  if (!meta) {
    return null;
  }
  return {
    sessionId,
    cwd: meta.cwd,
    title: meta.title ?? null,
    updatedAt: meta.updatedAt,
  };
}
