import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  JSONValue,
  MemoryEntry,
  MemoryStore,
  SearchOptions,
} from "@strands-agents/sdk";
import { currentMemoryScope } from "./runtime.js";

type StoredEntry = {
  storeName: string;
  content: string;
  metadata?: Record<string, JSONValue>;
  createdAt: string;
  updatedAt: string;
};

type FileMemoryStoreConfig = {
  baseDir: string;
  name: string;
  description?: string;
  maxSearchResults?: number;
  writable?: boolean;
  extraction?: MemoryStore["extraction"];
};

const DEFAULT_MAX_SEARCH_RESULTS = 3;
const UNSAFE_PATH_CHARS = /[^a-z0-9_-]+/g;

export class FileMemoryStore implements MemoryStore {
  readonly name: string;
  readonly description?: string;
  readonly maxSearchResults?: number;
  readonly writable: boolean;
  readonly extraction?: MemoryStore["extraction"];
  private readonly baseDir: string;

  constructor(config: FileMemoryStoreConfig) {
    this.baseDir = config.baseDir;
    this.name = config.name;
    this.description = config.description;
    this.maxSearchResults = config.maxSearchResults;
    this.writable = config.writable ?? false;
    this.extraction = config.extraction;
  }

  async search(query: string, options?: SearchOptions): Promise<MemoryEntry[]> {
    const entries = await this.readEntries();
    const limit =
      options?.maxSearchResults ??
      this.maxSearchResults ??
      DEFAULT_MAX_SEARCH_RESULTS;
    const normalizedQuery = normalize(query);

    const ranked = entries
      .map((entry) => ({
        entry,
        score: scoreEntry(normalizedQuery, entry),
      }))
      .filter(({ score }) => score > 0 || normalizedQuery.length === 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);

    return ranked.map(({ entry }) => ({
      content: entry.content,
      metadata: entry.metadata,
    }));
  }

  async add(
    content: string,
    metadata?: Record<string, JSONValue>,
  ): Promise<void> {
    const trimmed = content.trim();
    if (!trimmed) {
      return;
    }

    const now = new Date().toISOString();
    await this.appendEntry({
      storeName: this.name,
      content: trimmed,
      ...(metadata ? { metadata } : {}),
      createdAt: now,
      updatedAt: now,
    });
  }

  private async readEntries(): Promise<StoredEntry[]> {
    const path = this.scopeFilePath();
    try {
      const raw = await readFile(path, "utf8");
      const byFingerprint = new Map<string, StoredEntry>();

      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          continue;
        }
        if (!isStoredEntry(parsed) || parsed.storeName !== this.name) {
          continue;
        }

        byFingerprint.set(
          createFingerprint(parsed.content, parsed.metadata),
          parsed,
        );
      }

      return [...byFingerprint.values()];
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return [];
      }
      throw error;
    }
  }

  private async appendEntry(entry: StoredEntry): Promise<void> {
    const path = this.scopeFilePath();
    await mkdir(this.baseDir, { recursive: true });
    await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
  }

  private scopeFilePath(): string {
    return join(this.baseDir, `${sanitizePath(currentMemoryScope())}.jsonl`);
  }
}

function isStoredEntry(value: unknown): value is StoredEntry {
  if (!value || typeof value !== "object") {
    return false;
  }

  const entry = value as Partial<StoredEntry>;
  return (
    typeof entry.storeName === "string" &&
    typeof entry.content === "string" &&
    typeof entry.createdAt === "string" &&
    typeof entry.updatedAt === "string"
  );
}

function scoreEntry(normalizedQuery: string, entry: StoredEntry): number {
  if (normalizedQuery.length === 0) {
    return Date.parse(entry.updatedAt) || Date.parse(entry.createdAt) || 0;
  }

  const normalizedContent = normalize(entry.content);
  if (normalizedContent.length === 0) {
    return 0;
  }

  let score = 0;
  if (normalizedContent.includes(normalizedQuery)) {
    score += 100;
  }

  const contentTokens = new Set(tokenize(normalizedContent));
  for (const token of tokenize(normalizedQuery)) {
    if (contentTokens.has(token)) {
      score += 10;
    } else if (normalizedContent.includes(token)) {
      score += 4;
    }
  }

  // Prefer fresher entries when lexical relevance is tied.
  score += (Date.parse(entry.updatedAt) || 0) / 1_000_000_000_000;
  return score;
}

function createFingerprint(
  content: string,
  metadata?: Record<string, JSONValue>,
): string {
  return JSON.stringify({
    content: normalize(content),
    metadata: metadata ?? null,
  });
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return value.split(" ").filter(Boolean);
}

function sanitizePath(value: string): string {
  const normalized = value.trim().toLowerCase().replace(UNSAFE_PATH_CHARS, "_");
  return normalized.length > 0 ? normalized : "default";
}
