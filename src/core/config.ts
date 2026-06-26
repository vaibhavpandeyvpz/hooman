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

const SubagentsPartialSchema = z.object({
  enabled: z.boolean().optional(),
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
  subagents: SubagentsPartialSchema.optional(),
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
      subagents: {
        enabled: input.tools?.subagents?.enabled ?? true,
      },
    },
    compaction: {
      ratio: input.compaction?.ratio ?? DEFAULT_COMPACTION.ratio,
      keep: input.compaction?.keep ?? DEFAULT_COMPACTION.keep,
    },
  }));

const ConfigOverlaySchema = z
  .object({
    name: z.string().min(1).optional(),
    providers: z.array(NamedProviderConfigSchema).optional(),
    llms: z.array(NamedLlmConfigSchema).optional(),
    search: SearchPartialSchema.optional(),
    prompts: PromptsPartialSchema.optional(),
    tools: ToolsPartialSchema.optional(),
    compaction: CompactionPartialSchema.optional(),
  })
  .strict();

export type ConfigData = z.infer<typeof ConfigSchema>;
type ConfigOverlay = z.infer<typeof ConfigOverlaySchema>;
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
export type ConfigOptions = {
  overlayPaths?: readonly string[];
};

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
    subagents: { enabled: true },
  },
  compaction: {
    ratio: 0.75,
    keep: 5,
  },
});

function clone<T>(value: T): T {
  return structuredClone(value);
}

function mergeNamedEntries<T extends { name: string }>(
  base: readonly T[],
  overlay: readonly T[],
): T[] {
  const merged = new Map<string, T>(base.map((entry) => [entry.name, entry]));
  for (const entry of overlay) {
    merged.set(entry.name, entry);
  }
  return [...merged.values()];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge<T>(base: T, overlay: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(overlay)) {
    return overlay as T;
  }
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (value === undefined) {
      continue;
    }
    const current = result[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      result[key] = deepMerge(current, value);
      continue;
    }
    result[key] = value;
  }
  return result as T;
}

function applyOverlay(base: ConfigData, overlay: ConfigOverlay): ConfigData {
  const { providers, llms, ...remaining } = overlay;
  const mergedBase = deepMerge(base, remaining);
  return {
    ...mergedBase,
    providers: providers
      ? mergeNamedEntries(mergedBase.providers, providers)
      : mergedBase.providers,
    llms: llms ? mergeNamedEntries(mergedBase.llms, llms) : mergedBase.llms,
  };
}

function formatLoadError(path: string, error: unknown): Error {
  const message =
    error instanceof Error ? error.message : "Unknown configuration error.";
  return new Error(`Failed to load config from "${path}": ${message}`, {
    cause: error instanceof Error ? error : undefined,
  });
}

export { LlmProvider };
export type { NamedLlmConfig, NamedProviderConfig };

export class Config {
  private data!: ConfigData;
  private readonly path: string;
  private readonly overlayPaths: string[];

  public constructor(path: string, options?: ConfigOptions) {
    this.path = path;
    this.overlayPaths = [...(options?.overlayPaths ?? [])];
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

  private readJson(path: string, fallback: unknown): unknown {
    if (!existsSync(path)) {
      return fallback;
    }
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      throw formatLoadError(path, error);
    }
  }

  private readOverlay(path: string): ConfigOverlay {
    try {
      return ConfigOverlaySchema.parse(this.readJson(path, {}));
    } catch (error) {
      throw formatLoadError(path, error);
    }
  }

  public reload(): void {
    const wasMissing = !existsSync(this.path);
    let resolved: ConfigData;
    try {
      resolved = ConfigSchema.parse(
        this.readJson(this.path, defaultConfigData()),
      );
    } catch (error) {
      throw formatLoadError(this.path, error);
    }
    for (const overlayPath of this.overlayPaths) {
      resolved = applyOverlay(resolved, this.readOverlay(overlayPath));
    }
    try {
      this.data = ConfigSchema.parse(resolved);
    } catch (error) {
      const origins = [this.path, ...this.overlayPaths].join(", ");
      throw new Error(
        `Failed to validate merged config (sources: ${origins}): ${
          error instanceof Error
            ? error.message
            : "Unknown configuration error."
        }`,
        {
          cause: error instanceof Error ? error : undefined,
        },
      );
    }
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
