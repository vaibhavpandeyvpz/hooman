import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import {
  LlmProvider,
  type LlmOptions,
  type NamedLlmConfig,
  type NamedProviderConfig,
  type ProviderOptions,
  NamedLlmConfigSchema,
  NamedProviderConfigSchema,
} from "./models/types.js";

const SearchProviderSchema = z.enum([
  "brave",
  "exa",
  "firecrawl",
  "serper",
  "tavily",
]);

const CompactionPartialSchema = z.object({
  ratio: z.number().min(0).max(1).optional(),
  keep: z.number().int().nonnegative().optional(),
});

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

const SearchPartialSchema = z.object({
  enabled: z.boolean().optional(),
  provider: SearchProviderSchema.optional(),
  brave: z.object({ apiKey: z.string().min(1).optional() }).optional(),
  exa: z.object({ apiKey: z.string().min(1).optional() }).optional(),
  firecrawl: z.object({ apiKey: z.string().min(1).optional() }).optional(),
  serper: z.object({ apiKey: z.string().min(1).optional() }).optional(),
  tavily: z.object({ apiKey: z.string().min(1).optional() }).optional(),
});

const ToolsPartialSchema = z.object({
  todo: ToolTogglePartialSchema.optional(),
  fetch: ToolTogglePartialSchema.optional(),
  filesystem: ToolTogglePartialSchema.optional(),
  shell: ToolTogglePartialSchema.optional(),
  sleep: ToolTogglePartialSchema.optional(),
  agents: AgentsPartialSchema.optional(),
});

const DEFAULT_COMPACTION = { ratio: 0.75, keep: 5 } as const;
const DEFAULT_PROMPTS = {
  behaviour: true,
  communication: true,
  execution: true,
  guardrails: true,
} as const;

const ConfigSchema = z
  .object({
    name: z.string().min(1),
    providers: z.array(NamedProviderConfigSchema),
    llms: z.array(NamedLlmConfigSchema).min(1),
    search: SearchPartialSchema.nullish(),
    prompts: PromptsPartialSchema.nullish(),
    tools: ToolsPartialSchema.nullish(),
    compaction: CompactionPartialSchema.nullish(),
  })
  .superRefine((input, ctx) => {
    const seenProviders = new Set<string>();
    for (const provider of input.providers) {
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
      if (!seenProviders.has(llm.provider)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `LLM "${llm.name}" references unknown provider "${llm.provider}".`,
          path: ["llms"],
        });
      }
    }
  })
  .transform((input) => ({
    name: input.name,
    providers: input.providers,
    llms: input.llms,
    search: {
      enabled: input.search?.enabled ?? false,
      provider: input.search?.provider ?? "brave",
      brave: { apiKey: input.search?.brave?.apiKey },
      exa: { apiKey: input.search?.exa?.apiKey },
      firecrawl: { apiKey: input.search?.firecrawl?.apiKey },
      serper: { apiKey: input.search?.serper?.apiKey },
      tavily: { apiKey: input.search?.tavily?.apiKey },
    },
    prompts: {
      behaviour: input.prompts?.behaviour ?? DEFAULT_PROMPTS.behaviour,
      communication:
        input.prompts?.communication ?? DEFAULT_PROMPTS.communication,
      execution: input.prompts?.execution ?? DEFAULT_PROMPTS.execution,
      guardrails: input.prompts?.guardrails ?? DEFAULT_PROMPTS.guardrails,
    },
    tools: {
      todo: { enabled: input.tools?.todo?.enabled ?? true },
      fetch: { enabled: input.tools?.fetch?.enabled ?? true },
      filesystem: { enabled: input.tools?.filesystem?.enabled ?? true },
      shell: { enabled: input.tools?.shell?.enabled ?? true },
      sleep: { enabled: input.tools?.sleep?.enabled ?? true },
      agents: {
        enabled: input.tools?.agents?.enabled ?? true,
        concurrency: input.tools?.agents?.concurrency ?? 3,
      },
    },
    compaction: {
      ratio: input.compaction?.ratio ?? DEFAULT_COMPACTION.ratio,
      keep: input.compaction?.keep ?? DEFAULT_COMPACTION.keep,
    },
  }));

export type ConfigData = z.infer<typeof ConfigSchema>;
export type ProviderConfig = ProviderOptions;
export type LlmConfig = {
  provider: LlmProvider;
  providerOptions: ProviderOptions;
  llmOptions: LlmOptions;
};
export type ResolvedNamedLlmConfig = {
  name: string;
  provider: LlmProvider;
  providerOptions: ProviderOptions;
  llmOptions: LlmOptions;
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
      name: "Ollama",
      provider: LlmProvider.Ollama,
      options: {},
    },
  ],
  llms: [
    {
      name: "Default",
      provider: "Ollama",
      options: {
        model: "gemma4:e4b",
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
    todo: { enabled: true },
    fetch: { enabled: true },
    filesystem: { enabled: true },
    shell: { enabled: true },
    sleep: { enabled: true },
    agents: { enabled: true, concurrency: 2 },
  },
  compaction: {
    ratio: 0.75,
    keep: 5,
  },
});

function clone<T>(value: T): T {
  return structuredClone(value);
}

export { LlmProvider };
export type { NamedLlmConfig, NamedProviderConfig };

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
      (provider) => provider.name === entry.provider,
    );
    if (!matched) {
      throw new Error(
        `LLM "${entry.name}" references unknown provider "${entry.provider}".`,
      );
    }
    return {
      name: entry.name,
      provider: matched.provider,
      providerOptions: clone(matched.options),
      llmOptions: clone(entry.options),
      default: entry.default,
    };
  }

  get providers(): NamedProviderConfig[] {
    return clone(this.data.providers);
  }

  get llm(): LlmConfig {
    const found =
      this.data.llms.find((entry) => entry.default) ?? this.data.llms[0]!;
    const resolved = this.resolveNamedLlm(found);
    return {
      provider: resolved.provider,
      providerOptions: resolved.providerOptions,
      llmOptions: resolved.llmOptions,
    };
  }

  get llms(): NamedLlmConfig[] {
    return clone(this.data.llms);
  }

  get resolvedLlms(): ResolvedNamedLlmConfig[] {
    return this.data.llms.map((entry) => this.resolveNamedLlm(entry));
  }

  public resolveLlm(name: string): ResolvedNamedLlmConfig | undefined {
    const found = this.data.llms.find((entry) => entry.name === name);
    return found ? this.resolveNamedLlm(found) : undefined;
  }

  get search(): SearchConfig {
    return clone(this.data.search);
  }

  get prompts(): PromptsConfig {
    return clone(this.data.prompts);
  }

  get tools(): ToolsConfig {
    return clone(this.data.tools);
  }

  get compaction(): CompactionConfig {
    return clone(this.data.compaction);
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
    this.data = ConfigSchema.parse({ ...this.data, ...partial });
    this.persist();
  }
}
