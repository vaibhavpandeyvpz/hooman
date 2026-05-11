import crypto from "node:crypto";
import { embed, GgufEmbedder, GgufReranker } from "../inference/index.js";
import type { Memory, MemoryType } from "./types.js";
import type { Sqlite } from "./database.js";
import { open, prepare } from "./database.js";

const VEC_K_MULTIPLIER = 5;

function toMemory(
  row: {
    id: string;
    content: string;
    type: MemoryType;
    metadata_json: string;
    archived: number;
    created_at_ms: number;
  },
  distance?: number | null,
): Memory {
  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
  } catch {
    metadata = {};
  }
  const dist =
    typeof distance === "number" && Number.isFinite(distance) ? distance : null;
  return {
    id: row.id,
    content: row.content,
    type: row.type,
    metadata,
    archived: row.archived === 1,
    createdAt: new Date(row.created_at_ms),
    distance: dist,
    score: dist != null ? Math.max(0, Math.min(1, 1 - dist)) : null,
  };
}

/**
 * Small semantic memory store: sqlite rows + sqlite-vec embeddings.
 */
export class Brain {
  private readonly db: Sqlite;

  public constructor(
    path: string,
    private readonly embedder: GgufEmbedder,
    private readonly reranker: GgufReranker,
  ) {
    this.db = open(path);
  }

  public async warmup(): Promise<void> {
    await this.embedder.warmup();
    await this.reranker.warmup();
    const row = this.db
      .prepare(`SELECT 1 AS ok FROM memories LIMIT 1`)
      .get() as { ok: number } | undefined;
    if (!row) {
      return;
    }
    const probe = await this.embedder.embedQuery("__probe__");
    prepare(this.db, this.embedder.resolvedModelUri, probe.length);
  }

  /**
   * Store text with arbitrary JSON-serializable metadata; returns the new row id.
   */
  public async memorize(
    scope: string,
    content: string,
    type: MemoryType,
    metadata: Record<string, unknown> = {},
  ): Promise<string> {
    const id = crypto.randomUUID();
    const title =
      typeof metadata.title === "string" ? metadata.title : undefined;
    const embedding = await this.embedder.embedDocument(content, title);
    prepare(this.db, this.embedder.resolvedModelUri, embedding.length);

    const stmt1 = this.db.prepare(
      `INSERT INTO memories (id, scope, content, type, metadata_json, archived, created_at_ms)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
    );
    const stmt2 = this.db.prepare(
      `INSERT INTO brain_memory_vec (memory_id, embedding) VALUES (?, ?)`,
    );
    this.db.transaction(() => {
      stmt1.run(id, scope, content, type, JSON.stringify(metadata), Date.now());
      stmt2.run(id, embedding);
    })();

    return id;
  }

  /**
   * Search: vector retrieval when `q` is non-empty; otherwise lists recent memories.
   * Only non-archived rows in `scope` participate.
   * When `types` is non-empty, only rows whose `type` is in that list are returned.
   */
  public async search(
    scope: string,
    q: string,
    types?: MemoryType[],
    limit: number = 10,
  ): Promise<Memory[]> {
    const n = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 10;
    const typeSet = types != null && types.length > 0 ? new Set(types) : null;

    if (!q.trim()) {
      if (typeSet) {
        const tList = [...typeSet];
        const ph = tList.map(() => "?").join(",");
        const rows = this.db
          .prepare(
            `SELECT id, content, type, metadata_json, archived, created_at_ms
             FROM memories
             WHERE scope = ? AND archived = 0 AND type IN (${ph})
             ORDER BY created_at_ms DESC LIMIT ?`,
          )
          .all(scope, ...tList, n) as {
          id: string;
          content: string;
          type: MemoryType;
          metadata_json: string;
          archived: number;
          created_at_ms: number;
        }[];

        return rows.map((row) => toMemory(row, null));
      }

      const rows = this.db
        .prepare(
          `SELECT id, content, type, metadata_json, archived, created_at_ms
             FROM memories WHERE scope = ? AND archived = 0 ORDER BY created_at_ms DESC LIMIT ?`,
        )
        .all(scope, n) as {
        id: string;
        content: string;
        type: MemoryType;
        metadata_json: string;
        archived: number;
        created_at_ms: number;
      }[];

      return rows.map((row) => toMemory(row, null));
    }

    const embedding = Float32Array.from(await embed(this.embedder, q, "query"));
    prepare(this.db, this.embedder.resolvedModelUri, embedding.length);
    const kMult = typeSet ? VEC_K_MULTIPLIER * 4 : VEC_K_MULTIPLIER;
    const k = Math.max(1, n * kMult);
    const hits = this.db
      .prepare(
        `SELECT memory_id, distance FROM brain_memory_vec WHERE embedding MATCH ? AND k = ?`,
      )
      .all(embedding, k) as { memory_id: string; distance: number }[];

    if (hits.length === 0) {
      return [];
    }

    const byId = new Map(hits.map((h) => [h.memory_id, h.distance] as const));
    const ids = hits.map((h) => h.memory_id);
    const placeholders = ids.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT id, content, type, metadata_json, archived, created_at_ms
         FROM memories WHERE archived = 0 AND scope = ? AND id IN (${placeholders})`,
      )
      .all(scope, ...ids) as {
      id: string;
      content: string;
      type: MemoryType;
      metadata_json: string;
      archived: number;
      created_at_ms: number;
    }[];

    const candidates = rows.map((row) =>
      toMemory(row, byId.get(row.id) ?? null),
    );
    const ranked = await this.reranker.rerank(q, candidates, (m) => m.content);
    const filtered = typeSet
      ? ranked.filter((m) => typeSet.has(m.type))
      : ranked;
    return filtered.slice(0, n);
  }

  /** Mark a memory archived and remove it from the vector index. Only affects rows in `scope`. */
  public archive(scope: string, id: string): boolean {
    const row = this.db
      .prepare(
        `SELECT id, content, type, metadata_json, archived, created_at_ms
         FROM memories WHERE id = ? AND scope = ? AND archived = 0`,
      )
      .get(id, scope) as
      | {
          id: string;
          content: string;
          type: MemoryType;
          metadata_json: string;
          archived: number;
          created_at_ms: number;
        }
      | undefined;

    if (!row) {
      return false;
    }

    this.db.prepare(`DELETE FROM brain_memory_vec WHERE memory_id = ?`).run(id);
    this.db
      .prepare(`UPDATE memories SET archived = 1 WHERE id = ? AND scope = ?`)
      .run(id, scope);

    return true;
  }

  public async close(): Promise<void> {
    await this.embedder.dispose();
    await this.reranker.dispose();
    this.db.close();
  }
}
