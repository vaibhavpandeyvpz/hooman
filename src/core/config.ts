import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";

/** LLM backend; extend as you add providers. */
export enum LlmProvider {
  Anthropic = "anthropic",
  Bifrost = "bifrost",
  Google = "google",
  Groq = "groq",
  Moonshot = "moonshot",
  OpenAI = "openai",
  Ollama = "ollama",
  Bedrock = "bedrock",
  TensorZero = "tensorzero",
  Xai = "xai",
}

const ResolvedLlmSchema = z.object({
  provider: z.nativeEnum(LlmProvider),
  model: z.string().min(1),
  params: z.record(z.string(), z.any()).default({}),
});

const ProviderSchema = z.object({
  provider: z.nativeEnum(LlmProvider),
  params: z.record(z.string(), z.any()).default({}),
});

const NamedProviderSchema = z.object({
  name: z.string().min(1),
  options: ProviderSchema,
});

const LlmSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  params: z.record(z.string(), z.any()).default({}),
});

const NamedLlmSchema = z.object({
  name: z.string().min(1),
  options: LlmSchema,
  default: z.boolean().default(false),
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
  guardrails: true,
} as const;

const ToolTogglePartialSchema = z.object({
  enabled: z.boolean().optional(),
});

const PromptsPartialSchema = z.object({
  behaviour: z.boolean().optional(),
  communication: z.boolean().optional(),
  execution: z.boolean().optional(),
  guardrails: z.boolean().optional(),
});

const AgentsPartialSchema = z.object({
  enabled: z.boolean().optional(),
  concurrency: z.number().int().min(1).optional(),
});

const SearchProviderSchema = z.enum([
  "brave",
  "exa",
  "firecrawl",
  "serper",
  "tavily",
]);

const SearchPartialSchema = z.object({
  enabled: z.boolean().optional(),
  provider: SearchProviderSchema.optional(),
  brave: z
    .object({
      apiKey: z.string().min(1).optional(),
    })
    .optional(),
  exa: z
    .object({
      apiKey: z.string().min(1).optional(),
    })
    .optional(),
  firecrawl: z
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
  agents: AgentsPartialSchema.optional(),
});

const ConfigSchema = z
  .object({
    name: z.string().min(1),
    providers: z.array(NamedProviderSchema).nullish(),
    llms: z.array(NamedLlmSchema).min(1),
    search: SearchPartialSchema.nullish(),
    prompts: PromptsPartialSchema.nullish(),
    tools: ToolsPartialSchema.nullish(),
    compaction: CompactionPartialSchema.nullish().transform((c) => ({
      ratio: c?.ratio ?? DEFAULT_COMPACTION.ratio,
      keep: c?.keep ?? DEFAULT_COMPACTION.keep,
    })),
  })
  .superRefine((input, ctx) => {
    const seenProviders = new Set<string>();
    for (const provider of input.providers ?? []) {
      if (seenProviders.has(provider.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate provider name: "${provider.name}".`,
          path: ["providers"],
        });
        continue;
      }
      seenProviders.add(provider.name);
    }

    for (const llm of input.llms) {
      const ref = llm.options.provider;
      if (!seenProviders.has(ref)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `LLM "${llm.name}" references unknown provider "${ref}".`,
          path: ["llms"],
        });
      }
    }
  })
  .transform((input) => {
    return {
      name: input.name,
      providers: input.providers ?? [],
      llms: input.llms,
      search: {
        enabled: input.search?.enabled ?? false,
        provider: input.search?.provider ?? "brave",
        brave: {
          apiKey: input.search?.brave?.apiKey,
        },
        exa: {
          apiKey: input.search?.exa?.apiKey,
        },
        firecrawl: {
          apiKey: input.search?.firecrawl?.apiKey,
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
        agents: {
          enabled: input.tools?.agents?.enabled ?? true,
          concurrency: input.tools?.agents?.concurrency ?? 3,
        },
      },
      compaction: input.compaction,
    };
  });

export type ConfigData = z.infer<typeof ConfigSchema>;
export type ProviderConfig = z.infer<typeof ProviderSchema>;
export type NamedProviderConfig = z.infer<typeof NamedProviderSchema>;
export type LlmConfig = z.infer<typeof ResolvedLlmSchema>;
export type NamedLlmConfig = z.infer<typeof NamedLlmSchema>;
export type ResolvedNamedLlmConfig = {
  name: string;
  options: LlmConfig;
  default: boolean;
};
export type CompactionConfig = ConfigData["compaction"];
export type PromptsConfig = ConfigData["prompts"];
export type SearchConfig = ConfigData["search"];
export type ToolsConfig = ConfigData["tools"];

const defaultConfigData = (): ConfigData => ({
  name: "Hooman",
  providers: [
    {
      name: "ollama-local",
      options: {
        provider: LlmProvider.Ollama,
        params: {},
      },
    },
  ],
  llms: [
    {
      name: "Default",
      options: {
        provider: "ollama-local",
        model: "gemma4:e4b",
        params: {},
      },
      default: true,
    },
  ],
  search: {
    enabled: false,
    provider: "brave",
    brave: { apiKey: undefined },
    exa: { apiKey: undefined },
    firecrawl: { apiKey: undefined },
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

  private resolveNamedLlm(entry: NamedLlmConfig): ResolvedNamedLlmConfig {
    const matched = this.data.providers.find(
      (p) => p.name === entry.options.provider,
    );
    if (!matched) {
      throw new Error(
        `LLM "${entry.name}" references unknown provider "${entry.options.provider}".`,
      );
    }
    return {
      name: entry.name,
      default: entry.default,
      options: {
        provider: matched.options.provider,
        model: entry.options.model,
        params: {
          ...matched.options.params,
          ...entry.options.params,
        },
      },
    };
  }

  get providers(): NamedProviderConfig[] {
    return this.data.providers.map((provider) => ({
      ...provider,
      options: {
        ...provider.options,
        params: { ...provider.options.params },
      },
    }));
  }

  get llm(): LlmConfig {
    const found = this.data.llms.find((m) => m.default) ?? this.data.llms[0]!;
    return { ...this.resolveNamedLlm(found).options };
  }

  get llms(): NamedLlmConfig[] {
    return this.data.llms.map((m) => ({ ...m, options: { ...m.options } }));
  }

  get resolvedLlms(): ResolvedNamedLlmConfig[] {
    return this.data.llms.map((entry) => this.resolveNamedLlm(entry));
  }

  public resolveLlm(name: string): ResolvedNamedLlmConfig | undefined {
    const found = this.data.llms.find((entry) => entry.name === name);
    return found ? this.resolveNamedLlm(found) : undefined;
  }

  get search(): SearchConfig {
    return {
      ...this.data.search,
      brave: { ...this.data.search.brave },
      exa: { ...this.data.search.exa },
      firecrawl: { ...this.data.search.firecrawl },
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
      agents: { ...this.data.tools.agents },
    };
  }

  get compaction(): CompactionConfig {
    return this.data.compaction;
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
