import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";

/** LLM backend; extend as you add providers. */
export enum LlmProvider {
  Anthropic = "anthropic",
  Google = "google",
  OpenAI = "openai",
  Ollama = "ollama",
  Bedrock = "bedrock",
}

const LlmSchema = z.object({
  provider: z.nativeEnum(LlmProvider),
  model: z.string().min(1),
  params: z.record(z.string(), z.any()).default({}),
});

/** Partial compaction overrides from JSON; missing fields use defaults below. */
const CompactionPartialSchema = z.object({
  /** Fraction of context to target after compaction (e.g. 0.75 = keep ~75% budget). */
  ratio: z.number().min(0).max(1).optional(),
  /** Minimum number of recent turns / message groups to preserve verbatim when compacting. */
  keep: z.number().int().nonnegative().optional(),
});

const DEFAULT_COMPACTION = { ratio: 0.75, keep: 5 } as const;

const DEFAULT_CHROMA = {
  url: "http://127.0.0.1:8000",
  collection: { memory: "memory" },
} as const;

const ChromaPartialSchema = z.object({
  url: z.string().min(1).optional(),
  collection: z
    .object({
      memory: z.string().min(1).optional(),
    })
    .optional(),
});

const LtmPartialSchema = z.object({
  enabled: z.boolean().optional(),
  chroma: ChromaPartialSchema.optional(),
});

const ConfigSchema = z.object({
  name: z.string().min(1),
  llm: LlmSchema,
  allowed: z.array(z.string().min(1)).default([]),
  ltm: LtmPartialSchema.nullish().transform((ltm) => ({
    enabled: ltm?.enabled ?? false,
    chroma: {
      url: ltm?.chroma?.url ?? DEFAULT_CHROMA.url,
      collection: {
        memory:
          ltm?.chroma?.collection?.memory ?? DEFAULT_CHROMA.collection.memory,
      },
    },
  })),
  compaction: CompactionPartialSchema.nullish().transform((c) => ({
    ratio: c?.ratio ?? DEFAULT_COMPACTION.ratio,
    keep: c?.keep ?? DEFAULT_COMPACTION.keep,
  })),
});

export type ConfigData = z.infer<typeof ConfigSchema>;
export type LlmConfig = z.infer<typeof LlmSchema>;
export type CompactionConfig = ConfigData["compaction"];
export type LtmConfig = ConfigData["ltm"];

const defaultConfigData = (): ConfigData => ({
  name: "Hoomanity",
  llm: {
    provider: LlmProvider.Ollama,
    model: "gemma4:e4b",
    params: {},
  },
  allowed: [],
  ltm: {
    enabled: false,
    chroma: {
      url: "http://127.0.0.1:8000",
      collection: { memory: "memory" },
    },
  },
  compaction: {
    ratio: 0.75,
    keep: 5,
  },
});

export class Config {
  private data!: ConfigData;
  private readonly path: string;

  public constructor(path: string) {
    this.path = path;
    this.reload();
  }

  get name(): string {
    return this.data.name;
  }

  get llm(): LlmConfig {
    return this.data.llm;
  }

  get allowed(): string[] {
    return [...this.data.allowed];
  }

  get compaction(): CompactionConfig {
    return this.data.compaction;
  }

  get ltm(): LtmConfig {
    return this.data.ltm;
  }

  private readJson(): unknown {
    if (!existsSync(this.path)) {
      return defaultConfigData();
    }
    return JSON.parse(readFileSync(this.path, "utf8"));
  }

  public reload(): void {
    const wasMissing = !existsSync(this.path);
    this.data = ConfigSchema.parse(this.readJson());
    if (wasMissing) {
      this.persist();
    }
  }

  public persist(): void {
    writeFileSync(this.path, JSON.stringify(this.data, null, 2), "utf8");
  }

  public update(partial: Partial<ConfigData>): void {
    const updated = { ...this.data, ...partial };
    this.data = ConfigSchema.parse(updated);
    this.persist();
  }
}
