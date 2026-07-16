import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { SNAPSHOT_SCHEMA_VERSION } from "@strands-agents/sdk";
import type { NamedMcpTransport } from "../../core/mcp/config.js";
import type { SessionMode } from "../../core/state/session-mode.js";

/**
 * ACP session index: a single `sessions.jsonl` under the ACP sessions root.
 *
 * Conversation history is NOT stored here — the Strands `SessionManager`
 * snapshot (`<sessions>/<sessionId>/snapshot_latest.json`) is the source of
 * truth for messages. This file only carries the protocol-facing metadata the
 * ACP layer needs before/outside an agent instance: `session/list` rows and
 * the knobs that drive how a session is re-bootstrapped (`cwd`, session-scoped
 * MCP servers, mode/model/yolo, client user id).
 *
 * Concurrency model: the file is an append-only patch log. Every write is a
 * single-line `appendFile` (O_APPEND — atomic for our record sizes), reads
 * fold all lines last-wins per session id, deletes append a tombstone, and
 * unparseable (torn) lines are skipped. Compaction rewrites the folded state
 * via tmp+rename and aborts when the file changed underneath it, so a lost
 * concurrent patch (worst case: a title or `updatedAt` bump) is the only
 * hazard, and only during the rare compaction cycle.
 */
export type SessionIndexEntry = {
  sessionId: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  title?: string | null;
  /** Logical user from ACP client `_meta` (see `extractAcpClientUserId`). */
  userId?: string | null;
  /** Session-scoped MCP servers requested by the ACP client. */
  mcpServers?: NamedMcpTransport[];
  /**
   * Session created while the ACP process was started by the official VS Code
   * extension (`HOOMAN_X_VSCODE=true`); loads the local MCP config (home +
   * repo overlays) in addition to session-scoped servers.
   */
  vscode?: boolean;
  /**
   * Session created by Hooman's own daemon (`HOOMAN_X_DAEMON=true`). Selects
   * the daemon system prompt/mode on reactivation; MCP tools still come only
   * from session-scoped `mcpServers`, never local `mcp.json`.
   */
  daemon?: boolean;
  /**
   * Auto-approve tools without ACP permission prompts (`hooman.yolo` on agent
   * appState). Persisted so session reactivation restores the same behaviour.
   */
  yolo?: boolean;
  /** Persisted session planning mode (`hooman.sessionMode` / agent appState `mode`). */
  sessionMode?: SessionMode;
  /** Persisted named LLM (`config.llms[].name`) selected via `session/set_config_option`. */
  model?: string;
};

/** One line of `sessions.jsonl`: a partial patch or a delete tombstone. */
type SessionIndexRecord = Partial<SessionIndexEntry> & {
  sessionId: string;
  deleted?: boolean;
};

const INDEX_FILE = "sessions.jsonl";
/** Compact only once this many superseded/tombstoned records accumulate. */
const COMPACT_MIN_STALE_RECORDS = 64;

const indexPath = (root: string) => join(root, INDEX_FILE);

async function appendRecord(
  root: string,
  record: SessionIndexRecord,
): Promise<void> {
  await mkdir(root, { recursive: true });
  await appendFile(indexPath(root), `${JSON.stringify(record)}\n`, "utf8");
}

function isCompleteEntry(
  entry: Partial<SessionIndexEntry>,
): entry is SessionIndexEntry {
  return (
    typeof entry.sessionId === "string" &&
    typeof entry.cwd === "string" &&
    typeof entry.createdAt === "string" &&
    typeof entry.updatedAt === "string"
  );
}

type ParsedIndex = {
  entries: Map<string, SessionIndexEntry>;
  recordCount: number;
};

async function parseIndex(root: string): Promise<ParsedIndex> {
  let raw: string;
  try {
    raw = await readFile(indexPath(root), "utf8");
  } catch {
    return { entries: new Map(), recordCount: 0 };
  }
  const folded = new Map<string, Partial<SessionIndexEntry>>();
  let recordCount = 0;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let record: SessionIndexRecord;
    try {
      record = JSON.parse(trimmed) as SessionIndexRecord;
    } catch {
      // Torn line from a concurrent append; skip.
      continue;
    }
    if (!record || typeof record.sessionId !== "string") {
      continue;
    }
    recordCount++;
    if (record.deleted) {
      folded.delete(record.sessionId);
      continue;
    }
    folded.set(record.sessionId, {
      ...folded.get(record.sessionId),
      ...record,
    });
  }
  const entries = new Map<string, SessionIndexEntry>();
  for (const [sessionId, entry] of folded) {
    if (isCompleteEntry(entry)) {
      entries.set(sessionId, entry);
    }
  }
  return { entries, recordCount };
}

/** All live sessions, folded last-wins from the append log. */
export async function readSessionIndex(
  root: string,
): Promise<Map<string, SessionIndexEntry>> {
  return (await parseIndex(root)).entries;
}

export async function readSessionEntry(
  root: string,
  sessionId: string,
): Promise<SessionIndexEntry | null> {
  return (await readSessionIndex(root)).get(sessionId) ?? null;
}

/** Record a freshly created session (the full entry, not a patch). */
export async function writeSessionEntry(
  root: string,
  entry: SessionIndexEntry,
): Promise<void> {
  await appendRecord(root, entry);
}

/** Append a partial update; `updatedAt` is bumped unless the patch sets it. */
export async function patchSessionEntry(
  root: string,
  sessionId: string,
  patch: Partial<Omit<SessionIndexEntry, "sessionId">>,
): Promise<void> {
  await appendRecord(root, {
    sessionId,
    ...patch,
    updatedAt: patch.updatedAt ?? new Date().toISOString(),
  });
}

/** Bump `updatedAt` (list ordering) after a prompt turn. */
export async function touchSessionEntry(
  root: string,
  sessionId: string,
): Promise<void> {
  await patchSessionEntry(root, sessionId, {});
}

/** Append a delete tombstone. The Strands snapshot is deleted by the caller. */
export async function deleteSessionEntry(
  root: string,
  sessionId: string,
): Promise<void> {
  await appendRecord(root, {
    sessionId,
    deleted: true,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Rewrite the log as one line per live session when enough stale records have
 * accumulated. Best-effort: skipped entirely when the file changes between
 * reading and renaming (a concurrent writer wins).
 */
export async function compactSessionIndex(root: string): Promise<void> {
  const file = indexPath(root);
  let before;
  try {
    before = await stat(file);
  } catch {
    return;
  }
  const { entries, recordCount } = await parseIndex(root);
  if (recordCount - entries.size < COMPACT_MIN_STALE_RECORDS) {
    return;
  }
  const lines = [...entries.values()]
    .map((entry) => JSON.stringify(entry))
    .join("\n");
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, lines.length > 0 ? `${lines}\n` : "", "utf8");
  const after = await stat(file).catch(() => null);
  if (
    !after ||
    after.size !== before.size ||
    after.mtimeMs !== before.mtimeMs
  ) {
    await rm(tmp, { force: true });
    return;
  }
  await rename(tmp, file);
}

/**
 * One-time migration from the legacy per-session directory store
 * (`<root>/<sessionId>/{meta.json,messages.json}`) to the JSONL index.
 *
 * Metadata folds into `sessions.jsonl`. Messages were already dual-persisted
 * to the Strands snapshot; when a legacy session somehow lacks one, a minimal
 * messages-only snapshot is backfilled so its history survives. The legacy
 * directories are removed afterwards.
 */
export async function migrateLegacySessionStore(
  root: string,
  snapshotsRoot: string,
): Promise<void> {
  try {
    await stat(indexPath(root));
    return; // Already migrated (or a fresh index exists).
  } catch {
    /* fall through */
  }
  let dirents: Dirent[];
  try {
    dirents = await readdir(root, { withFileTypes: true });
  } catch {
    dirents = [];
  }
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) {
      continue;
    }
    const sessionId = dirent.name;
    const legacyDir = join(root, sessionId);
    let meta: Partial<SessionIndexEntry> | null = null;
    try {
      meta = JSON.parse(
        await readFile(join(legacyDir, "meta.json"), "utf8"),
      ) as Partial<SessionIndexEntry>;
    } catch {
      meta = null;
    }
    if (meta) {
      await appendRecord(root, { ...meta, sessionId });
      await backfillSnapshotFromLegacyMessages(
        legacyDir,
        join(snapshotsRoot, sessionId),
      );
    }
    await rm(legacyDir, { recursive: true, force: true });
  }
  // Leave an (at least empty) index behind so future boots skip the scan.
  try {
    await mkdir(root, { recursive: true });
    await writeFile(indexPath(root), "", { encoding: "utf8", flag: "wx" });
  } catch {
    /* index already exists — nothing to do */
  }
}

async function backfillSnapshotFromLegacyMessages(
  legacyDir: string,
  snapshotDir: string,
): Promise<void> {
  const snapshotFile = join(snapshotDir, "snapshot_latest.json");
  const hasSnapshot = await stat(snapshotFile).then(
    () => true,
    () => false,
  );
  if (hasSnapshot) {
    return;
  }
  let messages: unknown;
  try {
    messages = JSON.parse(
      await readFile(join(legacyDir, "messages.json"), "utf8"),
    );
  } catch {
    return;
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return;
  }
  await mkdir(dirname(snapshotFile), { recursive: true });
  await writeFile(
    snapshotFile,
    JSON.stringify(
      {
        scope: "agent",
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        createdAt: new Date().toISOString(),
        data: { messages },
        appData: {},
      },
      null,
      2,
    ),
    "utf8",
  );
}
