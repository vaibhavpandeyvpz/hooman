import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { sessionsPath } from "../utils/paths.js";

const SNAPSHOT_FILE = "snapshot_latest.json";
const SKIPPED_DIRS = new Set(["acp", "offloaded-content"]);

type SnapshotMessage = {
  role?: unknown;
  content?: unknown;
};

type SnapshotData = {
  messages?: unknown;
};

type SnapshotFile = {
  createdAt?: unknown;
  data?: SnapshotData;
};

export type CliSessionSummary = {
  sessionId: string;
  title: string;
  updatedAt: string;
  updatedAtMs: number;
  messageCount: number;
};

/**
 * List saved CLI sessions for the current project. Session storage is already
 * scoped per project (see {@link sessionsPath}), so every entry in the directory
 * belongs to this project — no per-session working-directory filtering needed.
 */
export async function listCliSessions(): Promise<CliSessionSummary[]> {
  const root = sessionsPath();
  const names = await listSessionDirectoryNames(root);
  const sessions: CliSessionSummary[] = [];

  await Promise.all(
    names.map(async (sessionId) => {
      const summary = await readSessionSummary(root, sessionId);
      if (summary) {
        sessions.push(summary);
      }
    }),
  );

  sessions.sort((a, b) => {
    if (b.updatedAtMs !== a.updatedAtMs) {
      return b.updatedAtMs - a.updatedAtMs;
    }
    return a.sessionId.localeCompare(b.sessionId);
  });
  return sessions;
}

/** Most recently updated session for the current project, if any. */
export async function latestCliSession(): Promise<CliSessionSummary | null> {
  const sessions = await listCliSessions();
  return sessions[0] ?? null;
}

async function listSessionDirectoryNames(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !SKIPPED_DIRS.has(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function readSessionSummary(
  root: string,
  sessionId: string,
): Promise<CliSessionSummary | null> {
  const snapshotPath = join(root, sessionId, SNAPSHOT_FILE);
  try {
    const [raw, fileStat] = await Promise.all([
      readFile(snapshotPath, "utf8"),
      stat(snapshotPath),
    ]);
    const parsed = JSON.parse(raw) as SnapshotFile;
    const messages = asMessages(parsed.data?.messages);
    const title = deriveSessionTitle(messages) ?? "Untitled session";
    const updatedAtDate = deriveUpdatedAt(fileStat.mtime, parsed.createdAt);
    return {
      sessionId,
      title,
      updatedAt: updatedAtDate.toISOString(),
      updatedAtMs: updatedAtDate.getTime(),
      messageCount: messages.length,
    };
  } catch {
    return null;
  }
}

function asMessages(value: unknown): SnapshotMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is SnapshotMessage => {
    return Boolean(item) && typeof item === "object";
  });
}

function deriveSessionTitle(messages: SnapshotMessage[]): string | null {
  for (const message of messages) {
    if (message.role !== "user") {
      continue;
    }
    const text = extractMessageText(message.content).trim();
    if (!text) {
      continue;
    }
    const firstLine = text.split(/\r?\n/, 1)[0]?.trim() ?? "";
    if (!firstLine) {
      continue;
    }
    return firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;
  }
  return null;
}

function extractMessageText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block === "string") {
      parts.push(block);
      continue;
    }
    if (!block || typeof block !== "object") {
      continue;
    }
    const textValue = (block as { text?: unknown }).text;
    if (typeof textValue === "string") {
      parts.push(textValue);
    }
  }
  return parts.join("\n");
}

function deriveUpdatedAt(fileMtime: Date, snapshotCreatedAt: unknown): Date {
  if (!Number.isNaN(fileMtime.getTime())) {
    return fileMtime;
  }
  if (typeof snapshotCreatedAt === "string") {
    const parsed = new Date(snapshotCreatedAt);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return new Date(0);
}
