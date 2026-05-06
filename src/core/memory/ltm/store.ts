import type {
  ArchiveMemoryInput,
  LongTermMemoryOptions,
  LongTermMemoryScope,
  Memory,
  SearchMemoryInput,
  SearchMemoryResult,
  StoreMemoryInput,
  StoreMemoryResult,
  UpdateMemoryInput,
} from "./types.js";
import { DEFAULT_LTM_EMBED_MODEL, type Config } from "../../config.js";
import { ltmDbPath, modelsCachePath } from "../../utils/paths.js";
import { LtmLlamaEmbedder } from "./llama-embed.js";
import {
  ensureVecTable,
  openLtmDatabase,
  persistEmbeddingSchemaMeta,
  type LtmDatabase,
} from "./sqlite.js";
import {
  DEFAULT_DEDUPE_THRESHOLD,
  DEFAULT_HALF_LIFE_MS,
  DEFAULT_REINFORCEMENT_STEP,
  buildMemorySqlFilter,
  clampSearchLimit,
  clampUnitInterval,
  getEffectiveStrength,
  similarity,
  toLtmMemoryRow,
  toMemory,
} from "./utils.js";

const VEC_K_MULTIPLIER = 10;

type SqliteMemoryRow = {
  id: string;
  user_id: string;
  type: string;
  status: string;
  content: string;
  importance: number;
  strength: number;
  access_count: number;
  confidence: number | null;
  created_at: number;
  updated_at: number | null;
  last_accessed_at: number | null;
  version: number;
  source: string;
  tags_json: string | null;
  entities_json: string | null;
  related_to_json: string | null;
  superseded_by: string | null;
};

function parseJsonArray(raw: string | null): string[] | undefined {
  if (raw == null || raw === "") {
    return undefined;
  }
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) {
      return undefined;
    }
    return v.filter((x): x is string => typeof x === "string");
  } catch {
    return undefined;
  }
}

function sqliteRowToMemory(r: SqliteMemoryRow): Memory {
  return toMemory(r.id, r.content, {
    userId: r.user_id,
    type: r.type as Memory["type"],
    status: r.status as Memory["status"],
    importance: r.importance,
    strength: r.strength,
    accessCount: r.access_count,
    confidence: r.confidence,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastAccessedAt: r.last_accessed_at,
    version: r.version,
    source: r.source as Memory["metadata"]["source"],
    tags: parseJsonArray(r.tags_json),
    entities: parseJsonArray(r.entities_json),
    relatedTo: parseJsonArray(r.related_to_json),
    supersededBy: r.superseded_by,
  });
}

const SELECT_MEMORIES = `
  SELECT id, user_id, type, status, content, importance, strength, access_count,
         confidence, created_at, updated_at, last_accessed_at, version, source,
         tags_json, entities_json, related_to_json, superseded_by
  FROM ltm_memories
`;

export class LongTermMemoryStore {
  private readonly db: LtmDatabase;
  private readonly embedder: LtmLlamaEmbedder;

  public constructor(
    _config: Config,
    private readonly options: LongTermMemoryOptions = {},
  ) {
    this.db = openLtmDatabase(ltmDbPath());
    this.embedder = new LtmLlamaEmbedder({
      modelUri: DEFAULT_LTM_EMBED_MODEL,
      cacheDir: modelsCachePath(),
    });
  }

  /**
   * Preload the local embed model so the first memory_search / memory_store call
   * does not block the LLM turn (otherwise the UI can sit at "thinking" with 0 tokens).
   */
  public async warmup(): Promise<void> {
    await this.embedder.warmup();
  }

  private hasVectorTable(): boolean {
    const row = this.db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='vectors_vec'`,
      )
      .get() as { name: string } | undefined;
    return row != null;
  }

  private ensureEmbeddingMeta(vec: Float32Array): void {
    ensureVecTable(this.db, vec.length);
    persistEmbeddingSchemaMeta(this.db, DEFAULT_LTM_EMBED_MODEL, vec.length);
  }

  private insertMemoryRow(memory: Memory): void {
    const meta = toLtmMemoryRow(memory);
    this.db
      .prepare(
        `INSERT INTO ltm_memories (
          id, user_id, type, status, content, importance, strength, access_count,
          confidence, created_at, updated_at, last_accessed_at, version, source,
          tags_json, entities_json, related_to_json, superseded_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        memory.id,
        memory.userId,
        memory.type,
        memory.status,
        memory.content,
        meta.importance,
        meta.strength,
        meta.accessCount,
        meta.confidence,
        meta.createdAt,
        meta.updatedAt,
        meta.lastAccessedAt,
        meta.version,
        meta.source,
        meta.tags ? JSON.stringify(meta.tags) : null,
        meta.entities ? JSON.stringify(meta.entities) : null,
        meta.relatedTo ? JSON.stringify(meta.relatedTo) : null,
        meta.supersededBy,
      );
  }

  private updateMemoryRow(memory: Memory): void {
    const meta = toLtmMemoryRow(memory);
    this.db
      .prepare(
        `UPDATE ltm_memories SET
          type = ?, status = ?, content = ?, importance = ?, strength = ?, access_count = ?,
          confidence = ?, updated_at = ?, last_accessed_at = ?, version = ?, source = ?,
          tags_json = ?, entities_json = ?, related_to_json = ?, superseded_by = ?
        WHERE id = ?`,
      )
      .run(
        memory.type,
        memory.status,
        memory.content,
        meta.importance,
        meta.strength,
        meta.accessCount,
        meta.confidence,
        meta.updatedAt,
        meta.lastAccessedAt,
        meta.version,
        meta.source,
        meta.tags ? JSON.stringify(meta.tags) : null,
        meta.entities ? JSON.stringify(meta.entities) : null,
        meta.relatedTo ? JSON.stringify(meta.relatedTo) : null,
        meta.supersededBy,
        memory.id,
      );
  }

  public async count(scope?: LongTermMemoryScope): Promise<number> {
    if (!scope) {
      const row = this.db
        .prepare(`SELECT COUNT(*) AS n FROM ltm_memories`)
        .get() as { n: number };
      return row.n;
    }
    const filter = buildMemorySqlFilter(scope, { includeArchived: true });
    const row = this.db
      .prepare(`SELECT COUNT(*) AS n FROM ltm_memories WHERE 1=1 ${filter.sql}`)
      .get(...filter.params) as { n: number };
    return row.n;
  }

  public async get(id: string): Promise<Memory | null> {
    const row = this.db.prepare(`${SELECT_MEMORIES} WHERE id = ?`).get(id) as
      | SqliteMemoryRow
      | undefined;
    if (!row) {
      return null;
    }
    return sqliteRowToMemory(row);
  }

  public async search(input: SearchMemoryInput): Promise<SearchMemoryResult[]> {
    if (!this.hasVectorTable()) {
      return [];
    }

    const embedding = await this.embedder.embedQuery(input.query);
    this.ensureEmbeddingMeta(embedding);

    const limit = clampSearchLimit(input.limit);
    const k = limit * VEC_K_MULTIPLIER;

    const vecResults = this.db
      .prepare(
        `SELECT memory_id, distance FROM vectors_vec WHERE embedding MATCH ? AND k = ?`,
      )
      .all(embedding, k) as { memory_id: string; distance: number }[];

    if (vecResults.length === 0) {
      return [];
    }

    const distanceById = new Map(
      vecResults.map((r) => [r.memory_id, r.distance] as const),
    );
    const orderedIds = vecResults.map((r) => r.memory_id);

    const filter = buildMemorySqlFilter(input.scope, {
      includeArchived: input.includeArchived,
      types: input.types,
      idIn: orderedIds,
    });

    const rows = this.db
      .prepare(`${SELECT_MEMORIES} WHERE 1=1 ${filter.sql}`)
      .all(...filter.params) as SqliteMemoryRow[];

    const memories: SearchMemoryResult[] = rows
      .map((row) => {
        const memory = sqliteRowToMemory(row);
        const distance = distanceById.get(memory.id);
        return {
          ...memory,
          distance: distance ?? null,
          effectiveStrength: getEffectiveStrength(
            memory.metadata,
            this.options.halfLifeMs ?? DEFAULT_HALF_LIFE_MS,
          ),
        } satisfies SearchMemoryResult;
      })
      .sort((a, b) => {
        const da = distanceById.get(a.id) ?? 1;
        const db_ = distanceById.get(b.id) ?? 1;
        return da - db_;
      })
      .slice(0, limit);

    if (input.reinforce !== false && memories.length > 0) {
      for (const memory of memories) {
        await this.reinforce(memory);
      }
    }

    return memories;
  }

  public async store(
    input: StoreMemoryInput,
    scope: LongTermMemoryScope,
  ): Promise<StoreMemoryResult> {
    const content = input.content.trim();
    if (!content) {
      throw new Error("Long-term memory content cannot be empty");
    }

    if (input.dedupe !== false) {
      const duplicate = await this.findDuplicate(content, scope);
      if (duplicate) {
        const merged = await this.mergeDuplicate(duplicate, input);
        return {
          id: merged.id,
          merged: true,
          memory: merged,
        };
      }
    }

    const now = Date.now();
    const memory: Memory = {
      id: crypto.randomUUID(),
      userId: scope.userId,
      type: input.type,
      status: "active",
      content,
      metadata: {
        createdAt: now,
        updatedAt: now,
        importance: clampUnitInterval(input.importance ?? 0.7, 0.7),
        strength: 0.5,
        accessCount: 0,
        version: 1,
        source: input.source ?? "assistant",
        confidence:
          input.confidence == null
            ? undefined
            : clampUnitInterval(input.confidence, 1),
        tags: input.tags,
        entities: input.entities,
        relatedTo: input.relatedTo,
      },
    };

    const embed = await this.embedder.embedDocument(memory.content);
    this.ensureEmbeddingMeta(embed);
    this.db.transaction(() => {
      this.insertMemoryRow(memory);
      this.db
        .prepare(`DELETE FROM vectors_vec WHERE memory_id = ?`)
        .run(memory.id);
      this.db
        .prepare(`INSERT INTO vectors_vec (memory_id, embedding) VALUES (?, ?)`)
        .run(memory.id, embed);
    })();

    return {
      id: memory.id,
      merged: false,
      memory,
    };
  }

  public async update(input: UpdateMemoryInput): Promise<Memory> {
    const existing = await this.get(input.id);
    if (!existing) {
      throw new Error(`Memory not found: ${input.id}`);
    }
    const content = input.content.trim();
    if (!content) {
      throw new Error("Long-term memory content cannot be empty");
    }

    const next: Memory = {
      ...existing,
      type: input.type ?? existing.type,
      status: input.status ?? existing.status,
      content,
      metadata: {
        ...existing.metadata,
        updatedAt: Date.now(),
        version: existing.metadata.version + 1,
        importance:
          input.importance == null
            ? existing.metadata.importance
            : clampUnitInterval(input.importance, existing.metadata.importance),
        confidence:
          input.confidence == null
            ? existing.metadata.confidence
            : clampUnitInterval(
                input.confidence,
                existing.metadata.confidence ?? 1,
              ),
        tags: input.tags ?? existing.metadata.tags,
        entities: input.entities ?? existing.metadata.entities,
        relatedTo: input.relatedTo ?? existing.metadata.relatedTo,
        supersededBy: input.supersededBy ?? existing.metadata.supersededBy,
      },
    };

    if (content !== existing.content) {
      const embed = await this.embedder.embedDocument(next.content);
      this.ensureEmbeddingMeta(embed);
      this.db.transaction(() => {
        this.updateMemoryRow(next);
        this.db
          .prepare(`DELETE FROM vectors_vec WHERE memory_id = ?`)
          .run(next.id);
        this.db
          .prepare(
            `INSERT INTO vectors_vec (memory_id, embedding) VALUES (?, ?)`,
          )
          .run(next.id, embed);
      })();
    } else {
      this.updateMemoryRow(next);
    }

    return next;
  }

  public async archive(input: ArchiveMemoryInput): Promise<Memory> {
    const existing = await this.get(input.id);
    if (!existing) {
      throw new Error(`Memory not found: ${input.id}`);
    }

    const archived: Memory = {
      ...existing,
      status: input.status ?? "archived",
      metadata: {
        ...existing.metadata,
        updatedAt: Date.now(),
        version: existing.metadata.version + 1,
        supersededBy: input.supersededBy ?? existing.metadata.supersededBy,
      },
    };

    this.updateMemoryRow(archived);
    return archived;
  }

  private async reinforce(memory: Memory): Promise<void> {
    const updated: Memory = {
      ...memory,
      metadata: {
        ...memory.metadata,
        strength:
          memory.metadata.strength +
          (this.options.reinforcementStep ?? DEFAULT_REINFORCEMENT_STEP),
        lastAccessedAt: Date.now(),
        accessCount: memory.metadata.accessCount + 1,
      },
    };
    this.updateMemoryRow(updated);
  }

  private async findDuplicate(
    content: string,
    scope: LongTermMemoryScope,
  ): Promise<Memory | null> {
    if (!this.hasVectorTable()) {
      return null;
    }
    const embedding = await this.embedder.embedQuery(content);
    this.ensureEmbeddingMeta(embedding);

    const vecResults = this.db
      .prepare(
        `SELECT memory_id, distance FROM vectors_vec WHERE embedding MATCH ? AND k = ?`,
      )
      .all(embedding, 30) as { memory_id: string; distance: number }[];

    if (vecResults.length === 0) {
      return null;
    }

    const ids = vecResults.map((r) => r.memory_id);
    const filter = buildMemorySqlFilter(scope, {
      status: "active",
      idIn: ids,
    });
    const rows = this.db
      .prepare(`${SELECT_MEMORIES} WHERE 1=1 ${filter.sql}`)
      .all(...filter.params) as SqliteMemoryRow[];

    const byId = new Map(rows.map((r) => [r.id, sqliteRowToMemory(r)]));
    const threshold = this.options.dedupeThreshold ?? DEFAULT_DEDUPE_THRESHOLD;

    for (const { memory_id } of vecResults) {
      const mem = byId.get(memory_id);
      if (!mem) {
        continue;
      }
      if (similarity(mem.content, content) >= threshold) {
        return mem;
      }
    }
    return null;
  }

  private async mergeDuplicate(
    existing: Memory,
    incoming: StoreMemoryInput,
  ): Promise<Memory> {
    const mergedTags = new Set([
      ...(existing.metadata.tags ?? []),
      ...(incoming.tags ?? []),
    ]);
    const mergedEntities = new Set([
      ...(existing.metadata.entities ?? []),
      ...(incoming.entities ?? []),
    ]);
    const mergedRelated = new Set([
      ...(existing.metadata.relatedTo ?? []),
      ...(incoming.relatedTo ?? []),
    ]);

    const updated: Memory = {
      ...existing,
      metadata: {
        ...existing.metadata,
        updatedAt: Date.now(),
        lastAccessedAt: Date.now(),
        accessCount: existing.metadata.accessCount + 1,
        version: existing.metadata.version + 1,
        strength:
          existing.metadata.strength +
          (this.options.reinforcementStep ?? DEFAULT_REINFORCEMENT_STEP),
        importance: Math.max(
          existing.metadata.importance,
          clampUnitInterval(incoming.importance ?? 0.7, 0.7),
        ),
        confidence:
          incoming.confidence == null
            ? existing.metadata.confidence
            : Math.max(
                existing.metadata.confidence ?? 0,
                clampUnitInterval(incoming.confidence, 1),
              ),
        tags: mergedTags.size > 0 ? [...mergedTags] : undefined,
        entities: mergedEntities.size > 0 ? [...mergedEntities] : undefined,
        relatedTo: mergedRelated.size > 0 ? [...mergedRelated] : undefined,
      },
    };

    this.updateMemoryRow(updated);
    return updated;
  }
}

export function create(
  config: Config,
  options?: LongTermMemoryOptions,
): LongTermMemoryStore {
  return new LongTermMemoryStore(config, options);
}
