import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sessionsPath } from "../utils/paths.js";

const SNAPSHOT_FILE = "snapshot_latest.json";
const SKIPPED_DIRS = new Set(["acp", "offloaded-content"]);

type SnapshotMessage = {
  role?: unknown;
  content?: unknown;
};

type SnapshotData = {
  messages?: unknown;
  state?: unknown;
  systemPrompt?: unknown;
};

type SnapshotFile = {
  createdAt?: unknown;
  data?: SnapshotData;
};

export type CliSessionSummary = {
  sessionId: string;
  title: string;
  cwd: string | null;
  updatedAt: string;
  updatedAtMs: number;
  messageCount: number;
};

export async function listCliSessions(params?: {
  cwd?: string;
}): Promise<CliSessionSummary[]> {
  const root = sessionsPath();
  const names = await listSessionDirectoryNames(root);
  const targetCwd = normalizePath(params?.cwd);
  const sessions: CliSessionSummary[] = [];

  await Promise.all(
    names.map(async (sessionId) => {
      const summary = await readSessionSummary(root, sessionId);
      if (!summary) {
        return;
      }
      if (targetCwd) {
        if (!summary.cwd) {
          return;
        }
        if (normalizePath(summary.cwd) !== targetCwd) {
          return;
        }
      }
      sessions.push(summary);
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

export async function latestCliSessionForCwd(
  cwd: string,
): Promise<CliSessionSummary | null> {
  const sessions = await listCliSessions({ cwd });
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
    const data = parsed.data;
    const messages = asMessages(data?.messages);
    const title = deriveSessionTitle(messages) ?? "Untitled session";
    const cwd = deriveSessionCwd(data);
    const updatedAtDate = deriveUpdatedAt(fileStat.mtime, parsed.createdAt);
    return {
      sessionId,
      title,
      cwd,
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

function deriveSessionCwd(data: SnapshotData | undefined): string | null {
  const stateCwd = extractStateCwd(data?.state);
  if (stateCwd) {
    return stateCwd;
  }
  const systemPrompt = data?.systemPrompt;
  if (typeof systemPrompt !== "string") {
    return null;
  }
  const match = systemPrompt.match(/- Primary working directory:\s*`([^`]+)`/m);
  return match?.[1]?.trim() || null;
}

function extractStateCwd(state: unknown): string | null {
  if (!state || typeof state !== "object") {
    return null;
  }
  const values = Object.values(state as Record<string, unknown>);
  for (const value of values) {
    if (!value || typeof value !== "object") {
      continue;
    }
    const cwd = (value as { cwd?: unknown }).cwd;
    if (typeof cwd === "string" && cwd.trim().length > 0) {
      return cwd;
    }
  }
  return null;
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

function normalizePath(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  try {
    return resolve(value);
  } catch {
    return value;
  }
}
