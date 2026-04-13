import { ChromaClient } from "chromadb";
import type { QueryRowResult } from "chromadb";
import { HFEmbedding } from "./embed.ts";
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
} from "./types.ts";
import type { Config } from "../../config.ts";
import {
  DEFAULT_DEDUPE_THRESHOLD,
  DEFAULT_HALF_LIFE_MS,
  DEFAULT_REINFORCEMENT_STEP,
  type ChromaMemoryMetadata,
  buildWhere,
  chromaClientArgsFromUrl,
  clampSearchLimit,
  clampUnitInterval,
  getEffectiveStrength,
  similarity,
  toChromaMetadata,
  toMemory,
} from "./utils.ts";

type Collection = Awaited<ReturnType<ChromaClient["getOrCreateCollection"]>>;

export class LongTermMemoryStore {
  private readonly client: ChromaClient;
  private collectionPromise: Promise<Collection> | null = null;

  public constructor(
    private readonly config: Config,
    private readonly options: LongTermMemoryOptions = {},
  ) {
    this.client = new ChromaClient({
      ...chromaClientArgsFromUrl(config.ltm.chroma.url),
    });
  }

  private async collection(): Promise<Collection> {
    if (!this.collectionPromise) {
      this.collectionPromise = this.client.getOrCreateCollection({
        name: this.config.ltm.chroma.collection.memory,
        embeddingFunction: new HFEmbedding(),
      });
    }
    return this.collectionPromise;
  }

  public async count(scope?: LongTermMemoryScope): Promise<number> {
    const collection = await this.collection();
    if (!scope) {
      return collection.count();
    }
    const result = await collection.get({
      where: buildWhere(scope, { includeArchived: true }),
      include: [],
    });
    return result.ids.length;
  }

  public async get(id: string): Promise<Memory | null> {
    const collection = await this.collection();
    const result = await collection.get<ChromaMemoryMetadata>({
      ids: [id],
      include: ["documents", "metadatas"],
    });
    const content = result.documents[0];
    const metadata = result.metadatas[0];
    if (!content) {
      return null;
    }
    return toMemory(id, content, metadata);
  }

  public async search(input: SearchMemoryInput): Promise<SearchMemoryResult[]> {
    const collection = await this.collection();
    const result = await collection.query<ChromaMemoryMetadata>({
      queryTexts: [input.query],
      nResults: clampSearchLimit(input.limit),
      where: buildWhere(input.scope, {
        includeArchived: input.includeArchived,
        types: input.types,
      }),
      include: ["documents", "metadatas", "distances"],
    });

    const rows = (result.rows()[0] ??
      []) as QueryRowResult<ChromaMemoryMetadata>[];
    const memories = rows
      .filter(
        (
          row: QueryRowResult<ChromaMemoryMetadata>,
        ): row is QueryRowResult<ChromaMemoryMetadata> & {
          document: string;
          metadata: ChromaMemoryMetadata;
        } => typeof row.document === "string" && !!row.metadata,
      )
      .map(
        (
          row: QueryRowResult<ChromaMemoryMetadata> & {
            document: string;
            metadata: ChromaMemoryMetadata;
          },
        ) => {
          const memory = toMemory(row.id, row.document, row.metadata);
          return {
            ...memory,
            distance: row.distance,
            effectiveStrength: getEffectiveStrength(
              memory.metadata,
              this.options.halfLifeMs ?? DEFAULT_HALF_LIFE_MS,
            ),
          } satisfies SearchMemoryResult;
        },
      );

    if (input.reinforce !== false && memories.length > 0) {
      await Promise.all(
        memories.map((memory: SearchMemoryResult) => this.reinforce(memory)),
      );
    }

    return memories;
  }

  public async store(
    input: StoreMemoryInput,
    scope: LongTermMemoryScope,
  ): Promise<StoreMemoryResult> {
    const collection = await this.collection();
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

    await collection.add({
      ids: [memory.id],
      documents: [memory.content],
      metadatas: [toChromaMetadata(memory)],
    });

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

    const collection = await this.collection();
    await collection.update({
      ids: [next.id],
      documents: [next.content],
      metadatas: [toChromaMetadata(next)],
    });

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

    const collection = await this.collection();
    await collection.update({
      ids: [archived.id],
      documents: [archived.content],
      metadatas: [toChromaMetadata(archived)],
    });

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

    const collection = await this.collection();
    await collection.update({
      ids: [updated.id],
      documents: [updated.content],
      metadatas: [toChromaMetadata(updated)],
    });
  }

  private async findDuplicate(
    content: string,
    scope: LongTermMemoryScope,
  ): Promise<Memory | null> {
    const collection = await this.collection();
    const result = await collection.query<ChromaMemoryMetadata>({
      queryTexts: [content],
      nResults: 3,
      where: buildWhere(scope, { status: "active" }),
      include: ["documents", "metadatas"],
    });

    const rows = result.rows()[0] ?? [];
    for (const row of rows) {
      if (!row.document || !row.metadata) {
        continue;
      }
      if (
        similarity(row.document, content) >=
        (this.options.dedupeThreshold ?? DEFAULT_DEDUPE_THRESHOLD)
      ) {
        return toMemory(row.id, row.document, row.metadata);
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

    const collection = await this.collection();
    await collection.update({
      ids: [updated.id],
      documents: [updated.content],
      metadatas: [toChromaMetadata(updated)],
    });

    return updated;
  }
}

export function create(
  config: Config,
  options?: LongTermMemoryOptions,
): LongTermMemoryStore {
  return new LongTermMemoryStore(config, options);
}
