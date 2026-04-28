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

const DEFAULT_PROMPTS = {
  behaviour: true,
  communication: true,
  execution: true,
  engineering: true,
  guardrails: true,
} as const;

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

const PromptsPartialSchema = z.object({
  behaviour: z.boolean().optional(),
  communication: z.boolean().optional(),
  execution: z.boolean().optional(),
  engineering: z.boolean().optional(),
  guardrails: z.boolean().optional(),
});

const AgentsPartialSchema = z.object({
  enabled: z.boolean().optional(),
  concurrency: z.number().int().min(1).optional(),
});

const SearchProviderSchema = z.enum(["brave", "serper", "tavily"]);

const SearchPartialSchema = z.object({
  enabled: z.boolean().optional(),
  provider: SearchProviderSchema.optional(),
  brave: z
    .object({
      apiKey: z.string().min(1).optional(),
    })
    .optional(),
  serper: z
    .object({
      apiKey: z.string().min(1).optional(),
    })
    .optional(),
  tavily: z
    .object({
      apiKey: z.string().min(1).optional(),
    })
    .optional(),
});

const ToolsPartialSchema = z.object({
  todo: ToolTogglePartialSchema.optional(),
  fetch: ToolTogglePartialSchema.optional(),
  filesystem: ToolTogglePartialSchema.optional(),
  shell: ToolTogglePartialSchema.optional(),
  sleep: ToolTogglePartialSchema.optional(),
  ltm: LtmPartialSchema.optional(),
  wiki: WikiPartialSchema.optional(),
  agents: AgentsPartialSchema.optional(),
});

const ConfigSchema = z
  .object({
    name: z.string().min(1),
    llm: LlmSchema,
    search: SearchPartialSchema.nullish(),
    prompts: PromptsPartialSchema.nullish(),
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
      search: {
        enabled: input.search?.enabled ?? false,
        provider: input.search?.provider ?? "brave",
        brave: {
          apiKey: input.search?.brave?.apiKey,
        },
        serper: {
          apiKey: input.search?.serper?.apiKey,
        },
        tavily: {
          apiKey: input.search?.tavily?.apiKey,
        },
      },
      prompts: {
        behaviour: input.prompts?.behaviour ?? DEFAULT_PROMPTS.behaviour,
        communication:
          input.prompts?.communication ?? DEFAULT_PROMPTS.communication,
        execution: input.prompts?.execution ?? DEFAULT_PROMPTS.execution,
        engineering: input.prompts?.engineering ?? DEFAULT_PROMPTS.engineering,
        guardrails: input.prompts?.guardrails ?? DEFAULT_PROMPTS.guardrails,
      },
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
        sleep: {
          enabled: input.tools?.sleep?.enabled ?? true,
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
        agents: {
          enabled: input.tools?.agents?.enabled ?? true,
          concurrency: input.tools?.agents?.concurrency ?? 3,
        },
      },
      compaction: input.compaction,
    };
  });

export type ConfigData = z.infer<typeof ConfigSchema>;
export type LlmConfig = z.infer<typeof LlmSchema>;
export type CompactionConfig = ConfigData["compaction"];
export type PromptsConfig = ConfigData["prompts"];
export type LtmConfig = ConfigData["tools"]["ltm"];
export type WikiConfig = ConfigData["tools"]["wiki"];
export type SearchConfig = ConfigData["search"];
export type ToolsConfig = ConfigData["tools"];

const defaultConfigData = (): ConfigData => ({
  name: "Hooman",
  llm: {
    provider: LlmProvider.Ollama,
    model: "gemma4:e4b",
    params: {},
  },
  search: {
    enabled: false,
    provider: "brave",
    brave: { apiKey: undefined },
    serper: { apiKey: undefined },
    tavily: { apiKey: undefined },
  },
  prompts: { ...DEFAULT_PROMPTS },
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
    sleep: {
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
    agents: {
      enabled: true,
      concurrency: 2,
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

  get search(): SearchConfig {
    return {
      ...this.data.search,
      brave: { ...this.data.search.brave },
      serper: { ...this.data.search.serper },
      tavily: { ...this.data.search.tavily },
    };
  }

  get prompts(): PromptsConfig {
    return { ...this.data.prompts };
  }

  get tools(): ToolsConfig {
    return {
      ...this.data.tools,
      todo: { ...this.data.tools.todo },
      fetch: { ...this.data.tools.fetch },
      filesystem: { ...this.data.tools.filesystem },
      shell: { ...this.data.tools.shell },
      sleep: { ...this.data.tools.sleep },
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
      agents: { ...this.data.tools.agents },
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
