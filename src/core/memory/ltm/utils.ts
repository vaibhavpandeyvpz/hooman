import type { Where } from "chromadb";
import type {
  LongTermMemoryScope,
  Memory,
  MemorySource,
  MemoryStatus,
  MemoryType,
} from "./types.ts";

export const DEFAULT_HALF_LIFE_MS = 1000 * 60 * 60 * 24 * 30;
export const DEFAULT_REINFORCEMENT_STEP = 0.1;
export const DEFAULT_DEDUPE_THRESHOLD = 0.92;
const DEFAULT_SEARCH_LIMIT = 5;
const MAX_SEARCH_LIMIT = 20;

export type ChromaMemoryMetadata = {
  userId: string;
  type: MemoryType;
  status: MemoryStatus;
  importance: number;
  strength: number;
  accessCount: number;
  confidence: number | null;
  createdAt: number;
  updatedAt: number | null;
  lastAccessedAt: number | null;
  version: number;
  source: MemorySource;
  /** Omitted when empty: Chroma rejects `[]` for list metadata values. */
  tags?: string[];
  entities?: string[];
  relatedTo?: string[];
  supersededBy: string | null;
};

export function clampSearchLimit(limit?: number): number {
  const value = Math.trunc(limit ?? DEFAULT_SEARCH_LIMIT);
  return Math.min(Math.max(value, 1), MAX_SEARCH_LIMIT);
}

export function clampUnitInterval(value: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, value));
}

function asStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string" && value.length > 0) {
    return [value];
  }
  return undefined;
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function similarity(left: string, right: string): number {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) {
    return 0;
  }
  if (a === b) {
    return 1;
  }

  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  const containment = longer.includes(shorter)
    ? shorter.length / longer.length
    : 0;

  const tokensA = new Set(a.split(" "));
  const tokensB = new Set(b.split(" "));
  let intersection = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) {
      intersection += 1;
    }
  }
  const union = new Set([...tokensA, ...tokensB]).size;
  const jaccard = union === 0 ? 0 : intersection / union;

  return Math.max(containment, jaccard);
}

export function getEffectiveStrength(
  metadata: Pick<
    Memory["metadata"],
    "createdAt" | "lastAccessedAt" | "strength"
  >,
  halfLifeMs: number,
): number {
  const reference = metadata.lastAccessedAt ?? metadata.createdAt;
  const age = Math.max(0, Date.now() - reference);
  return metadata.strength * Math.exp(-age / halfLifeMs);
}

export function toChromaMetadata(memory: Memory): ChromaMemoryMetadata {
  const tags = (memory.metadata.tags ?? []).filter((t) => t.length > 0);
  const entities = (memory.metadata.entities ?? []).filter((t) => t.length > 0);
  const relatedTo = (memory.metadata.relatedTo ?? []).filter(
    (t) => t.length > 0,
  );

  const meta: ChromaMemoryMetadata = {
    userId: memory.userId,
    type: memory.type,
    status: memory.status,
    importance: memory.metadata.importance,
    strength: memory.metadata.strength,
    accessCount: memory.metadata.accessCount,
    confidence: memory.metadata.confidence ?? null,
    createdAt: memory.metadata.createdAt,
    updatedAt: memory.metadata.updatedAt ?? null,
    lastAccessedAt: memory.metadata.lastAccessedAt ?? null,
    version: memory.metadata.version,
    source: memory.metadata.source,
    supersededBy: memory.metadata.supersededBy ?? null,
  };

  if (tags.length > 0) {
    meta.tags = tags;
  }
  if (entities.length > 0) {
    meta.entities = entities;
  }
  if (relatedTo.length > 0) {
    meta.relatedTo = relatedTo;
  }

  return meta;
}

export function toMemory(
  id: string,
  content: string,
  metadata: ChromaMemoryMetadata | null | undefined,
): Memory {
  const createdAt = Number(metadata?.createdAt ?? Date.now());
  return {
    id,
    userId: metadata?.userId ?? "",
    type: (metadata?.type ?? "semantic") as MemoryType,
    status: (metadata?.status ?? "active") as MemoryStatus,
    content,
    metadata: {
      createdAt,
      updatedAt: metadata?.updatedAt ?? undefined,
      lastAccessedAt: metadata?.lastAccessedAt ?? undefined,
      importance: clampUnitInterval(Number(metadata?.importance ?? 0.7), 0.7),
      strength: Number(metadata?.strength ?? 0.5),
      confidence:
        metadata?.confidence == null
          ? undefined
          : clampUnitInterval(Number(metadata.confidence), 1),
      accessCount: Number(metadata?.accessCount ?? 0),
      version: Number(metadata?.version ?? 1),
      source: (metadata?.source ?? "assistant") as MemorySource,
      tags: asStringArray(metadata?.tags),
      entities: asStringArray(metadata?.entities),
      supersededBy: metadata?.supersededBy ?? undefined,
      relatedTo: asStringArray(metadata?.relatedTo),
    },
  };
}

export function buildWhere(
  scope: LongTermMemoryScope,
  options?: {
    status?: MemoryStatus;
    includeArchived?: boolean;
    types?: MemoryType[];
  },
): Where {
  // Chroma v3: top-level `where` must have exactly one key (field predicate or $and/$or).
  const parts: Where[] = [{ userId: scope.userId } as Where];

  const statusFilter = options?.includeArchived
    ? options.status
    : (options?.status ?? "active");

  if (statusFilter !== undefined) {
    parts.push({ status: statusFilter } as Where);
  }

  if (options?.types?.length) {
    parts.push({ type: { $in: options.types } } as Where);
  }

  if (parts.length === 1) {
    return parts[0]!;
  }

  return { $and: parts } as Where;
}

export function chromaClientArgsFromUrl(urlString: string): {
  host: string;
  port?: number;
  ssl: boolean;
} {
  const url = new URL(urlString);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : undefined,
    ssl: url.protocol === "https:",
  };
}
