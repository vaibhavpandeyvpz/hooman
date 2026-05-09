import fs from "node:fs";
import path from "node:path";
import BetterSqlite from "better-sqlite3";
import * as vector from "sqlite-vec";

export type Sqlite = BetterSqlite.Database;

const META_DIMS = "embedding_dims";
const META_MODEL = "embedding_model_id";

export type WikiDocRecord = {
  doc_id: string;
  file_name: string;
  md_path: string;
  original_path: string;
  original_mime_type: string;
  content_hash: string;
  updated_at_ms: number;
};

export type WikiChunkRecord = {
  chunk_id: string;
  doc_id: string;
  chunk_index: number;
  content: string;
};

export type WikiSearchRow = WikiChunkRecord &
  Pick<
    WikiDocRecord,
    "file_name" | "md_path" | "original_path" | "original_mime_type"
  >;

function getStoreMeta(db: Sqlite, key: string): string | null {
  const row = db
    .prepare(`SELECT value FROM wiki_store_meta WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function setStoreMeta(db: Sqlite, key: string, value: string): void {
  db.prepare(
    `INSERT INTO wiki_store_meta (key, value) VALUES (?, ?)
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
    CREATE TABLE IF NOT EXISTS wiki_store_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wiki_docs (
      doc_id TEXT PRIMARY KEY NOT NULL,
      file_name TEXT NOT NULL,
      md_path TEXT NOT NULL,
      original_path TEXT NOT NULL,
      original_mime_type TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_wiki_docs_md_path ON wiki_docs(md_path);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_wiki_docs_original_path ON wiki_docs(original_path);

    CREATE TABLE IF NOT EXISTS wiki_chunks (
      chunk_id TEXT PRIMARY KEY NOT NULL,
      doc_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      FOREIGN KEY(doc_id) REFERENCES wiki_docs(doc_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_wiki_chunks_doc_id ON wiki_chunks(doc_id);
  `);
}

export class Database {
  private readonly db: Sqlite;

  public constructor(file: string) {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new BetterSqlite(file);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    migrate(this.db);
  }

  public close(): void {
    this.db.close();
  }

  public prepare(modelId: string, dimensions: number): void {
    const existing = this.db
      .prepare(
        `SELECT sql FROM sqlite_master WHERE type='table' AND name='wiki_chunk_vec'`,
      )
      .get() as { sql: string } | null;

    if (existing) {
      const match = existing.sql.match(/float\[(\d+)\]/);
      const hasId = existing.sql.includes("chunk_id");
      const hasCosine = existing.sql.includes("distance_metric=cosine");
      const existingDims = match?.[1] ? Number.parseInt(match[1], 10) : null;
      if (existingDims === dimensions && hasId && hasCosine) {
        return;
      }
      if (existingDims !== null && existingDims !== dimensions) {
        throw new Error(
          `Wiki embedding dimension mismatch: index is ${existingDims}d but the model produces ${dimensions}d. ` +
            "Use the previous model or delete the wiki database (data loss).",
        );
      }
      this.db.exec("DROP TABLE IF EXISTS wiki_chunk_vec");
    }

    this.db.exec(
      `CREATE VIRTUAL TABLE wiki_chunk_vec USING vec0(chunk_id TEXT PRIMARY KEY, embedding float[${dimensions}] distance_metric=cosine)`,
    );

    const existingModel = getStoreMeta(this.db, META_MODEL);
    if (existingModel != null && existingModel !== modelId) {
      throw new Error(
        `Wiki index was built with model "${existingModel}" but config uses "${modelId}". ` +
          "Align models or delete the wiki database (data loss).",
      );
    }
    setStoreMeta(this.db, META_MODEL, modelId);
    setStoreMeta(this.db, META_DIMS, String(dimensions));
  }

  public countDocs(): number {
    const row = this.db
      .prepare(`SELECT COUNT(*) AS c FROM wiki_docs`)
      .get() as { c: number } | undefined;
    return typeof row?.c === "number" && Number.isFinite(row.c) ? row.c : 0;
  }

  public listDocs(page: number, pageSize: number): WikiDocRecord[] {
    const offset = Math.max(0, (Math.max(1, page) - 1) * Math.max(1, pageSize));
    const limit = Math.max(1, pageSize);
    return this.db
      .prepare(
        `SELECT doc_id, file_name, md_path, original_path, original_mime_type, content_hash, updated_at_ms
         FROM wiki_docs ORDER BY updated_at_ms DESC LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as WikiDocRecord[];
  }

  public getDocById(docId: string): WikiDocRecord | null {
    const row = this.db
      .prepare(
        `SELECT doc_id, file_name, md_path, original_path, original_mime_type, content_hash, updated_at_ms
         FROM wiki_docs WHERE doc_id = ?`,
      )
      .get(docId) as WikiDocRecord | undefined;
    return row ?? null;
  }

  public getDocByOriginalPath(originalPath: string): WikiDocRecord | null {
    const row = this.db
      .prepare(
        `SELECT doc_id, file_name, md_path, original_path, original_mime_type, content_hash, updated_at_ms
         FROM wiki_docs WHERE original_path = ?`,
      )
      .get(originalPath) as WikiDocRecord | undefined;
    return row ?? null;
  }

  public removeDoc(docId: string): void {
    const chunkRows = this.db
      .prepare(`SELECT chunk_id FROM wiki_chunks WHERE doc_id = ?`)
      .all(docId) as { chunk_id: string }[];
    const delVec = this.db.prepare(
      `DELETE FROM wiki_chunk_vec WHERE chunk_id = ?`,
    );
    const delChunks = this.db.prepare(
      `DELETE FROM wiki_chunks WHERE doc_id = ?`,
    );
    const delDoc = this.db.prepare(`DELETE FROM wiki_docs WHERE doc_id = ?`);
    this.db.transaction(() => {
      for (const row of chunkRows) {
        delVec.run(row.chunk_id);
      }
      delChunks.run(docId);
      delDoc.run(docId);
    })();
  }

  public addDocAndChunks(
    doc: WikiDocRecord,
    chunks: Array<{ chunk_id: string; chunk_index: number; content: string }>,
    embeddings: Float32Array[],
  ): void {
    if (chunks.length !== embeddings.length) {
      throw new Error("Chunk/embedding count mismatch");
    }
    const insDoc = this.db.prepare(
      `INSERT INTO wiki_docs (doc_id, file_name, md_path, original_path, original_mime_type, content_hash, updated_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const insChunk = this.db.prepare(
      `INSERT INTO wiki_chunks (chunk_id, doc_id, chunk_index, content) VALUES (?, ?, ?, ?)`,
    );
    const insVec = this.db.prepare(
      `INSERT INTO wiki_chunk_vec (chunk_id, embedding) VALUES (?, ?)`,
    );
    this.db.transaction(() => {
      insDoc.run(
        doc.doc_id,
        doc.file_name,
        doc.md_path,
        doc.original_path,
        doc.original_mime_type,
        doc.content_hash,
        doc.updated_at_ms,
      );
      for (let i = 0; i < chunks.length; i += 1) {
        const chunk = chunks[i]!;
        insChunk.run(
          chunk.chunk_id,
          doc.doc_id,
          chunk.chunk_index,
          chunk.content,
        );
        insVec.run(chunk.chunk_id, embeddings[i]!);
      }
    })();
  }

  public vectorSearch(
    embedding: Float32Array,
    k: number,
  ): Array<{ chunk_id: string; distance: number }> {
    return this.db
      .prepare(
        `SELECT chunk_id, distance FROM wiki_chunk_vec WHERE embedding MATCH ? AND k = ?`,
      )
      .all(embedding, k) as Array<{ chunk_id: string; distance: number }>;
  }

  public getSearchRowsByChunkIds(chunkIds: string[]): WikiSearchRow[] {
    if (chunkIds.length === 0) {
      return [];
    }
    const placeholders = chunkIds.map(() => "?").join(",");
    return this.db
      .prepare(
        `SELECT c.chunk_id, c.doc_id, c.chunk_index, c.content,
                d.file_name, d.md_path, d.original_path, d.original_mime_type
         FROM wiki_chunks c
         JOIN wiki_docs d ON d.doc_id = c.doc_id
         WHERE c.chunk_id IN (${placeholders})`,
      )
      .all(...chunkIds) as WikiSearchRow[];
  }
}
