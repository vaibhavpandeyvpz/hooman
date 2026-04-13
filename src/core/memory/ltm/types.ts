export type MemoryStatus = "active" | "archived" | "superseded" | "deleted";

export type MemoryType =
  | "fact"
  | "preference"
  | "task"
  | "episodic"
  | "semantic";

export interface Memory {
  id: string;

  // multi-tenant partitioning
  userId: string;

  type: MemoryType;
  status: MemoryStatus;

  content: string; // human-readable
  embedding?: number[]; // optional (store-level)

  metadata: {
    // timestamps
    createdAt: number;
    updatedAt?: number;
    lastAccessedAt?: number;

    // scoring
    importance: number; // write-time signal (0–1)
    strength: number; // dynamic reinforcement (0–∞)
    confidence?: number; // extraction confidence

    // lifecycle
    accessCount: number;
    version: number;

    // provenance
    source: "user" | "assistant" | "system" | "inferred";

    // structure
    tags?: string[];
    entities?: string[];

    // relationships
    supersededBy?: string; // memory id
    relatedTo?: string[]; // graph-lite
  };
}

export type MemorySource = Memory["metadata"]["source"];

export interface LongTermMemoryScope {
  userId: string;
}

export interface LongTermMemoryOptions {
  halfLifeMs?: number;
  reinforcementStep?: number;
  dedupeThreshold?: number;
}

export interface StoreMemoryInput {
  content: string;
  type: MemoryType;
  importance?: number;
  confidence?: number;
  tags?: string[];
  entities?: string[];
  relatedTo?: string[];
  source?: MemorySource;
  dedupe?: boolean;
}

export interface SearchMemoryInput {
  query: string;
  scope: LongTermMemoryScope;
  types?: MemoryType[];
  limit?: number;
  includeArchived?: boolean;
  reinforce?: boolean;
}

export interface SearchMemoryResult extends Memory {
  distance?: number | null;
  effectiveStrength: number;
}

export interface UpdateMemoryInput {
  id: string;
  content: string;
  type?: MemoryType;
  status?: MemoryStatus;
  importance?: number;
  confidence?: number;
  tags?: string[];
  entities?: string[];
  relatedTo?: string[];
  supersededBy?: string;
}

export interface ArchiveMemoryInput {
  id: string;
  status?: Extract<MemoryStatus, "archived" | "superseded" | "deleted">;
  supersededBy?: string;
}

export interface StoreMemoryResult {
  id: string;
  merged: boolean;
  memory: Memory;
}
