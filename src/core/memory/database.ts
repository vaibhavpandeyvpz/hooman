import fs from "node:fs";
import path from "node:path";
import BetterSqlite from "better-sqlite3";
import * as vector from "sqlite-vec";

export type Sqlite = BetterSqlite.Database;

const META_DIMS = "embedding_dims";
const META_MODEL = "embedding_model_id";

function getStoreMeta(db: Sqlite, key: string): string | null {
  const row = db
    .prepare(`SELECT value FROM brain_store_meta WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function setStoreMeta(db: Sqlite, key: string, value: string): void {
  db.prepare(
    `INSERT INTO brain_store_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

function migrate(db: Sqlite): void {
  vector.load(db);
  try {
    const row = db.prepare(`SELECT vec_version() AS version`).get() as
      | { version?: string }
      | undefined;
    if (!row?.version || typeof row.version !== "string") {
      throw new Error("vec_version() returned no version");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `sqlite-vec extension is unavailable (probe failed: ${msg}). ` +
        "Ensure sqlite-vec native bindings are installed for your platform.",
    );
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS brain_store_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY NOT NULL,
      scope TEXT NOT NULL,
      content TEXT NOT NULL,
      type TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope);
    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
    CREATE INDEX IF NOT EXISTS idx_memories_archived ON memories(archived);
  `);
}

export function prepare(db: Sqlite, modelId: string, dimensions: number): void {
  const existing = db
    .prepare(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='brain_memory_vec'`,
    )
    .get() as { sql: string } | null;

  if (existing) {
    const match = existing.sql.match(/float\[(\d+)\]/);
    const hasId = existing.sql.includes("memory_id");
    const hasCosine = existing.sql.includes("distance_metric=cosine");
    const existingDims = match?.[1] ? Number.parseInt(match[1], 10) : null;
    if (existingDims === dimensions && hasId && hasCosine) {
      return;
    }
    if (existingDims !== null && existingDims !== dimensions) {
      throw new Error(
        `Brain embedding dimension mismatch: index is ${existingDims}d but the model produces ${dimensions}d. ` +
          "Use the previous embed model or delete the brain database (data loss).",
      );
    }
    db.exec("DROP TABLE IF EXISTS brain_memory_vec");
  }

  db.exec(
    `CREATE VIRTUAL TABLE brain_memory_vec USING vec0(memory_id TEXT PRIMARY KEY, embedding float[${dimensions}] distance_metric=cosine)`,
  );
  const existingModel = getStoreMeta(db, META_MODEL);
  if (existingModel != null && existingModel !== modelId) {
    throw new Error(
      `Brain was built with embed model "${existingModel}" but config uses "${modelId}". ` +
        "Align models or delete the brain database (data loss).",
    );
  }
  setStoreMeta(db, META_MODEL, modelId);
  setStoreMeta(db, META_DIMS, String(dimensions));
}

export function open(file: string): Sqlite {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const db = new BetterSqlite(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}
