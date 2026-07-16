import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { sessionsPath } from "../core/utils/paths.js";

/**
 * Persisted external-conversation-key → ACP-session-ID binding, so daemon
 * restarts can `session/resume` prior conversations instead of losing them.
 * Append-only JSONL patch log (same fold/tombstone shape as
 * `src/acp/sessions/store.ts`), scoped to the current project.
 */
export type DaemonSessionBinding = {
  externalKey: string;
  acpSessionId: string;
  cwd: string;
  userId?: string | null;
  createdAt: string;
  updatedAt: string;
};

type BindingRecord = Partial<DaemonSessionBinding> & {
  externalKey: string;
  deleted?: boolean;
};

const bindingsPath = () => join(sessionsPath(), "daemon", "bindings.jsonl");

function isCompleteBinding(
  entry: Partial<DaemonSessionBinding>,
): entry is DaemonSessionBinding {
  return (
    typeof entry.externalKey === "string" &&
    typeof entry.acpSessionId === "string" &&
    typeof entry.cwd === "string" &&
    typeof entry.createdAt === "string" &&
    typeof entry.updatedAt === "string"
  );
}

/** Reads and folds the append-only bindings log; unparseable (torn) lines are skipped. */
export async function readDaemonSessionBindings(): Promise<
  Map<string, DaemonSessionBinding>
> {
  let raw: string;
  try {
    raw = await readFile(bindingsPath(), "utf8");
  } catch {
    return new Map();
  }
  const folded = new Map<string, Partial<DaemonSessionBinding>>();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let record: BindingRecord;
    try {
      record = JSON.parse(trimmed) as BindingRecord;
    } catch {
      continue;
    }
    if (!record || typeof record.externalKey !== "string") {
      continue;
    }
    if (record.deleted) {
      folded.delete(record.externalKey);
      continue;
    }
    folded.set(record.externalKey, {
      ...folded.get(record.externalKey),
      ...record,
    });
  }
  const entries = new Map<string, DaemonSessionBinding>();
  for (const [key, entry] of folded) {
    if (isCompleteBinding(entry)) {
      entries.set(key, entry);
    }
  }
  return entries;
}

/** Appends a full or partial binding patch; `updatedAt` is bumped unless the patch sets it. */
export async function patchDaemonSessionBinding(
  patch: Partial<Omit<DaemonSessionBinding, "externalKey">> & {
    externalKey: string;
  },
): Promise<void> {
  const path = bindingsPath();
  await mkdir(dirname(path), { recursive: true });
  await appendFile(
    path,
    `${JSON.stringify({
      ...patch,
      updatedAt: patch.updatedAt ?? new Date().toISOString(),
    })}\n`,
    "utf8",
  );
}
