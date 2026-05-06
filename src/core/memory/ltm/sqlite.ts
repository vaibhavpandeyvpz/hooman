import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

export type LtmDatabase = Database.Database;

const META_DIMS = "embedding_dims";
const META_MODEL = "embedding_model_id";

export function loadSqliteVecExtension(db: LtmDatabase): void {
  sqliteVec.load(db);
}

export function verifySqliteVecLoaded(db: LtmDatabase): void {
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
}

function migrateSchema(db: LtmDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ltm_memories (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      content TEXT NOT NULL,
      importance REAL NOT NULL,
      strength REAL NOT NULL,
      access_count INTEGER NOT NULL,
      confidence REAL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER,
      last_accessed_at INTEGER,
      version INTEGER NOT NULL,
      source TEXT NOT NULL,
      tags_json TEXT,
      entities_json TEXT,
      related_to_json TEXT,
      superseded_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ltm_user_status ON ltm_memories(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_ltm_user_type ON ltm_memories(user_id, type);

    CREATE TABLE IF NOT EXISTS ltm_store_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

export function openLtmDatabase(path: string): LtmDatabase {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  loadSqliteVecExtension(db);
  verifySqliteVecLoaded(db);
  migrateSchema(db);
  return db;
}

export function getStoreMeta(db: LtmDatabase, key: string): string | null {
  const row = db
    .prepare(`SELECT value FROM ltm_store_meta WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setStoreMeta(
  db: LtmDatabase,
  key: string,
  value: string,
): void {
  db.prepare(
    `INSERT INTO ltm_store_meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

export function ensureVecTable(db: LtmDatabase, dimensions: number): void {
  const tableInfo = db
    .prepare(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='vectors_vec'`,
    )
    .get() as { sql: string } | null;

  if (tableInfo) {
    const match = tableInfo.sql.match(/float\[(\d+)\]/);
    const hasMemoryId = tableInfo.sql.includes("memory_id");
    const hasCosine = tableInfo.sql.includes("distance_metric=cosine");
    const existingDims = match?.[1] ? Number.parseInt(match[1], 10) : null;
    if (existingDims === dimensions && hasMemoryId && hasCosine) {
      return;
    }
    if (existingDims !== null && existingDims !== dimensions) {
      throw new Error(
        `LTM embedding dimension mismatch: existing vectors are ${existingDims}d but the current model produces ${dimensions}d. ` +
          "Change back to the previous embed model or delete ~/.hooman/ltm.sqlite to rebuild (data loss).",
      );
    }
    db.exec("DROP TABLE IF EXISTS vectors_vec");
  }

  db.exec(
    `CREATE VIRTUAL TABLE vectors_vec USING vec0(memory_id TEXT PRIMARY KEY, embedding float[${dimensions}] distance_metric=cosine)`,
  );
}

export function persistEmbeddingSchemaMeta(
  db: LtmDatabase,
  modelId: string,
  dimensions: number,
): void {
  const existingModel = getStoreMeta(db, META_MODEL);
  if (existingModel != null && existingModel !== modelId) {
    throw new Error(
      `LTM database was built with embed model "${existingModel}" but config requests "${modelId}". ` +
        "Change DEFAULT_LTM_EMBED_MODEL in Hooman or delete ltm.sqlite to rebuild (data loss).",
    );
  }
  setStoreMeta(db, META_MODEL, modelId);
  setStoreMeta(db, META_DIMS, String(dimensions));
}

export { META_DIMS, META_MODEL };
