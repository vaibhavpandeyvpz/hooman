import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";

/** LLM backend; extend as you add providers. */
export enum LlmProvider {
  Anthropic = "anthropic",
  Google = "google",
  Groq = "groq",
  Moonshot = "moonshot",
  OpenAI = "openai",
  Ollama = "ollama",
  Bedrock = "bedrock",
  Xai = "xai",
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

const FeatureTogglePartialSchema = z.object({
  enabled: z.boolean().optional(),
});

const FeaturesPartialSchema = z.object({
  fetch: FeatureTogglePartialSchema.optional(),
  filesystem: FeatureTogglePartialSchema.optional(),
  shell: FeatureTogglePartialSchema.optional(),
  ltm: LtmPartialSchema.optional(),
});

const ToolsPartialSchema = z.object({
  allowed: z.array(z.string().min(1)).default([]),
});

const ConfigSchema = z
  .object({
    name: z.string().min(1),
    llm: LlmSchema,
    tools: ToolsPartialSchema.default({ allowed: [] }),
    features: FeaturesPartialSchema.nullish(),
    compaction: CompactionPartialSchema.nullish().transform((c) => ({
      ratio: c?.ratio ?? DEFAULT_COMPACTION.ratio,
      keep: c?.keep ?? DEFAULT_COMPACTION.keep,
    })),
  })
  .transform((input) => {
    const ltm = input.features?.ltm;
    return {
      name: input.name,
      llm: input.llm,
      tools: input.tools,
      features: {
        fetch: {
          enabled: input.features?.fetch?.enabled ?? true,
        },
        filesystem: {
          enabled: input.features?.filesystem?.enabled ?? true,
        },
        shell: {
          enabled: input.features?.shell?.enabled ?? true,
        },
        ltm: {
          enabled: ltm?.enabled ?? false,
          chroma: {
            url: ltm?.chroma?.url ?? DEFAULT_CHROMA.url,
            collection: {
              memory:
                ltm?.chroma?.collection?.memory ??
                DEFAULT_CHROMA.collection.memory,
            },
          },
        },
      },
      compaction: input.compaction,
    };
  });

export type ConfigData = z.infer<typeof ConfigSchema>;
export type LlmConfig = z.infer<typeof LlmSchema>;
export type CompactionConfig = ConfigData["compaction"];
export type LtmConfig = ConfigData["features"]["ltm"];
export type ToolsConfig = ConfigData["tools"];
export type FeaturesConfig = ConfigData["features"];

const defaultConfigData = (): ConfigData => ({
  name: "Hooman",
  llm: {
    provider: LlmProvider.Ollama,
    model: "gemma4:e4b",
    params: {},
  },
  tools: {
    allowed: [],
  },
  features: {
    fetch: {
      enabled: true,
    },
    filesystem: {
      enabled: true,
    },
    shell: {
      enabled: true,
    },
    ltm: {
      enabled: false,
      chroma: {
        url: "http://127.0.0.1:8000",
        collection: { memory: "memory" },
      },
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

  get tools(): ToolsConfig {
    return {
      ...this.data.tools,
      allowed: [...this.data.tools.allowed],
    };
  }

  get compaction(): CompactionConfig {
    return this.data.compaction;
  }

  get features(): FeaturesConfig {
    return {
      ...this.data.features,
      fetch: { ...this.data.features.fetch },
      filesystem: { ...this.data.features.filesystem },
      shell: { ...this.data.features.shell },
      ltm: {
        ...this.data.features.ltm,
        chroma: {
          ...this.data.features.ltm.chroma,
          collection: { ...this.data.features.ltm.chroma.collection },
        },
      },
    };
  }

  get ltm(): LtmConfig {
    return this.features.ltm;
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
