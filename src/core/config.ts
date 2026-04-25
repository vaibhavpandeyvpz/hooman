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

const DEFAULT_WIKI_CHROMA = {
  url: "http://127.0.0.1:8000",
  collection: { wiki: "wiki" },
} as const;

const LtmChromaPartialSchema = z.object({
  url: z.string().min(1).optional(),
  collection: z
    .object({
      memory: z.string().min(1).optional(),
    })
    .optional(),
});

const LtmPartialSchema = z.object({
  enabled: z.boolean().optional(),
  chroma: LtmChromaPartialSchema.optional(),
});

const WikiChromaPartialSchema = z.object({
  url: z.string().min(1).optional(),
  collection: z
    .object({
      wiki: z.string().min(1).optional(),
    })
    .optional(),
});

const WikiPartialSchema = z.object({
  enabled: z.boolean().optional(),
  chroma: WikiChromaPartialSchema.optional(),
});

const ToolTogglePartialSchema = z.object({
  enabled: z.boolean().optional(),
});

const ToolsPartialSchema = z.object({
  todo: ToolTogglePartialSchema.optional(),
  fetch: ToolTogglePartialSchema.optional(),
  filesystem: ToolTogglePartialSchema.optional(),
  shell: ToolTogglePartialSchema.optional(),
  ltm: LtmPartialSchema.optional(),
  wiki: WikiPartialSchema.optional(),
  mcp: ToolTogglePartialSchema.optional(),
  skills: ToolTogglePartialSchema.optional(),
});

const ConfigSchema = z
  .object({
    name: z.string().min(1),
    llm: LlmSchema,
    tools: ToolsPartialSchema.nullish(),
    compaction: CompactionPartialSchema.nullish().transform((c) => ({
      ratio: c?.ratio ?? DEFAULT_COMPACTION.ratio,
      keep: c?.keep ?? DEFAULT_COMPACTION.keep,
    })),
  })
  .transform((input) => {
    const ltm = input.tools?.ltm;
    const wiki = input.tools?.wiki;
    return {
      name: input.name,
      llm: input.llm,
      tools: {
        todo: {
          enabled: input.tools?.todo?.enabled ?? true,
        },
        fetch: {
          enabled: input.tools?.fetch?.enabled ?? true,
        },
        filesystem: {
          enabled: input.tools?.filesystem?.enabled ?? true,
        },
        shell: {
          enabled: input.tools?.shell?.enabled ?? true,
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
        wiki: {
          enabled: wiki?.enabled ?? false,
          chroma: {
            url: wiki?.chroma?.url ?? DEFAULT_WIKI_CHROMA.url,
            collection: {
              wiki:
                wiki?.chroma?.collection?.wiki ??
                DEFAULT_WIKI_CHROMA.collection.wiki,
            },
          },
        },
        mcp: {
          enabled: input.tools?.mcp?.enabled ?? false,
        },
        skills: {
          enabled: input.tools?.skills?.enabled ?? false,
        },
      },
      compaction: input.compaction,
    };
  });

export type ConfigData = z.infer<typeof ConfigSchema>;
export type LlmConfig = z.infer<typeof LlmSchema>;
export type CompactionConfig = ConfigData["compaction"];
export type LtmConfig = ConfigData["tools"]["ltm"];
export type WikiConfig = ConfigData["tools"]["wiki"];
export type ToolsConfig = ConfigData["tools"];

const defaultConfigData = (): ConfigData => ({
  name: "Hooman",
  llm: {
    provider: LlmProvider.Ollama,
    model: "gemma4:e4b",
    params: {},
  },
  tools: {
    todo: {
      enabled: true,
    },
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
    wiki: {
      enabled: false,
      chroma: {
        url: "http://127.0.0.1:8000",
        collection: { wiki: "wiki" },
      },
    },
    mcp: {
      enabled: false,
    },
    skills: {
      enabled: false,
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
      todo: { ...this.data.tools.todo },
      fetch: { ...this.data.tools.fetch },
      filesystem: { ...this.data.tools.filesystem },
      shell: { ...this.data.tools.shell },
      ltm: {
        ...this.data.tools.ltm,
        chroma: {
          ...this.data.tools.ltm.chroma,
          collection: { ...this.data.tools.ltm.chroma.collection },
        },
      },
      wiki: {
        ...this.data.tools.wiki,
        chroma: {
          ...this.data.tools.wiki.chroma,
          collection: { ...this.data.tools.wiki.chroma.collection },
        },
      },
      mcp: { ...this.data.tools.mcp },
      skills: { ...this.data.tools.skills },
    };
  }

  get compaction(): CompactionConfig {
    return this.data.compaction;
  }

  get ltm(): LtmConfig {
    return this.tools.ltm;
  }

  get wiki(): WikiConfig {
    return this.tools.wiki;
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
