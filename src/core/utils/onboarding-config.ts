/**
 * Shared first-run onboarding: validate inference + search credentials and
 * write `~/.hooman/config.json`. Used by the CLI Ink flow and the VS Code
 * webview onboarding.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  DEFAULT_PREFETCH_MODEL_BY_PROVIDER,
  resolvePrefetchModels,
  type PrefetchProviderId,
  type PrefetchedModel,
} from "./models-prefetch.js";
import {
  probeSearchProvider,
  type SearchProbeProvider,
} from "./search-probe.js";
import { configJsonPath } from "./paths.js";

export type OnboardingProviderId = PrefetchProviderId;
export type OnboardingSearchProvider = SearchProbeProvider;

export type OnboardingFieldDef = {
  key: string;
  label: string;
  placeholder?: string;
  sensitive?: boolean;
  required?: boolean;
};

export type OnboardingInput = {
  provider: OnboardingProviderId;
  providerOptions: Record<string, string>;
  azureDeployment?: string;
  searchProvider: OnboardingSearchProvider;
  searchOptions: Record<string, string>;
};

export type OnboardingProviderInput = {
  provider: OnboardingProviderId;
  providerOptions: Record<string, string>;
  azureDeployment?: string;
};

export const ONBOARDING_PROVIDER_LABELS: Record<OnboardingProviderId, string> =
  {
    anthropic: "Anthropic",
    azure: "Azure OpenAI",
    bedrock: "Bedrock",
    google: "Google",
    groq: "Groq",
    "llama-cpp": "llama.cpp",
    minimax: "MiniMax",
    mlx: "mlx",
    moonshot: "Moonshot",
    ollama: "Ollama",
    openai: "OpenAI",
    openrouter: "OpenRouter",
    xai: "xAI",
  };

export const ONBOARDING_SEARCH_LABELS: Record<
  OnboardingSearchProvider,
  string
> = {
  brave: "Brave",
  duckduckgo: "DuckDuckGo",
  exa: "Exa",
  firecrawl: "Firecrawl",
  litellm: "LiteLLM",
  serper: "Serper",
  tavily: "Tavily",
};

/** Inference providers offered during first-run onboarding. */
export const ONBOARDING_PROVIDERS: OnboardingProviderId[] = [
  "llama-cpp",
  "mlx",
  "ollama",
  "anthropic",
  "openai",
  "google",
  "azure",
  "bedrock",
  "groq",
  "minimax",
  "moonshot",
  "openrouter",
  "xai",
];

/** Search providers offered during first-run onboarding. */
export const ONBOARDING_SEARCH_PROVIDERS: OnboardingSearchProvider[] = [
  "duckduckgo",
  "brave",
  "exa",
  "firecrawl",
  "litellm",
  "serper",
  "tavily",
];

/** True when `~/.hooman/config.json` (or `HOOMAN_HOME`) already exists. */
export function hasOnboardingConfig(path: string = configJsonPath()): boolean {
  return existsSync(path);
}

export function onboardingProviderFields(
  provider: OnboardingProviderId,
): OnboardingFieldDef[] {
  switch (provider) {
    case "llama-cpp":
    case "mlx":
      return [];
    case "ollama":
      return [
        {
          key: "baseURL",
          label: "Base URL",
          placeholder: "http://127.0.0.1:11434",
        },
      ];
    case "azure":
      return [
        {
          key: "baseURL",
          label: "Base URL",
          placeholder: "https://your-resource.openai.azure.com/openai",
          required: true,
        },
        {
          key: "apiKey",
          label: "API key",
          placeholder: "...",
          sensitive: true,
          required: true,
        },
        {
          key: "deployment",
          label: "Deployment name",
          placeholder: "gpt-5.4-mini",
          required: true,
        },
      ];
    case "bedrock":
      return [
        {
          key: "region",
          label: "Region",
          placeholder: "us-west-2",
          required: true,
        },
        {
          key: "profile",
          label: "AWS profile",
          placeholder: "default",
          required: true,
        },
      ];
    default:
      return [
        {
          key: "apiKey",
          label: "API key",
          placeholder: "...",
          sensitive: true,
          required: true,
        },
      ];
  }
}

export function onboardingSearchFields(
  provider: OnboardingSearchProvider,
): OnboardingFieldDef[] {
  if (provider === "duckduckgo") {
    return [];
  }
  if (provider === "litellm") {
    return [
      {
        key: "baseURL",
        label: "Base URL",
        placeholder: "http://localhost:4000",
        required: true,
      },
      {
        key: "apiKey",
        label: "API key",
        placeholder: "...",
        sensitive: true,
        required: true,
      },
      {
        key: "tool",
        label: "Tool",
        placeholder: "perplexity-search",
        required: true,
      },
    ];
  }
  return [
    {
      key: "apiKey",
      label: "API key",
      placeholder: "...",
      sensitive: true,
      required: true,
    },
  ];
}

export function initialOnboardingProviderValues(
  provider: OnboardingProviderId,
): Record<string, string> {
  if (provider === "bedrock") {
    return { region: "us-west-2", profile: "default" };
  }
  return {};
}

/** Validate provider credentials via the list endpoint (throws on failure). */
export async function validateOnboardingProvider(
  input: OnboardingProviderInput,
): Promise<void> {
  await resolvePrefetchModels({
    provider: input.provider,
    apiKey: input.providerOptions.apiKey,
    baseURL: input.providerOptions.baseURL,
    region: input.providerOptions.region,
    accessKeyId: input.providerOptions.accessKeyId,
    secretAccessKey: input.providerOptions.secretAccessKey,
    azureDeployment: input.azureDeployment?.trim(),
  });
}

/** Probe the selected search provider with a one-result test query. */
export async function validateOnboardingSearch(
  provider: OnboardingSearchProvider,
  options: Record<string, string>,
): Promise<void> {
  await probeSearchProvider({
    provider,
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    tool: options.tool,
  });
}

/**
 * Validate inference + search credentials, then write config.json.
 * `configPath` defaults to {@link configJsonPath}.
 */
export async function completeOnboardingConfig(
  input: OnboardingInput,
  onStatus?: (phase: "listing" | "writing", message?: string) => void,
  configPath: string = configJsonPath(),
): Promise<void> {
  onStatus?.("listing", "Validating credentials…");
  const azureDeployment = input.azureDeployment?.trim();
  let models: PrefetchedModel[];
  try {
    models = await resolvePrefetchModels({
      provider: input.provider,
      apiKey: input.providerOptions.apiKey,
      baseURL: input.providerOptions.baseURL,
      region: input.providerOptions.region,
      accessKeyId: input.providerOptions.accessKeyId,
      secretAccessKey: input.providerOptions.secretAccessKey,
      azureDeployment,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not validate credentials for ${ONBOARDING_PROVIDER_LABELS[input.provider]}: ${detail}`,
    );
  }

  onStatus?.("listing", "Validating search…");
  try {
    await validateOnboardingSearch(input.searchProvider, input.searchOptions);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not validate ${ONBOARDING_SEARCH_LABELS[input.searchProvider]} search: ${detail}`,
    );
  }

  onStatus?.("writing", "Writing config…");
  const config = buildHomeConfig(input, models);
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function buildHomeConfig(
  input: OnboardingInput,
  models: PrefetchedModel[],
): Record<string, unknown> {
  const displayName = ONBOARDING_PROVIDER_LABELS[input.provider];
  const providerOptions = buildProviderOptions(input);
  const search = buildSearchBlock(input.searchProvider, input.searchOptions);

  const fallback: PrefetchedModel = {
    id: DEFAULT_PREFETCH_MODEL_BY_PROVIDER[input.provider],
    displayName: DEFAULT_PREFETCH_MODEL_BY_PROVIDER[input.provider],
  };
  const list = models.length > 0 ? models : [fallback];
  const usedNames = new Set<string>();
  const llms = list.map((model, index) => {
    const entry: Record<string, unknown> = {
      name: uniqueLlmName(model.displayName, model.id, usedNames),
      provider: displayName,
      options: { model: model.id },
      metadata: { name: model.id },
      default: index === 0,
    };
    if (input.provider === "llama-cpp" || input.provider === "mlx") {
      const context = model.id.toLowerCase().includes("qwen") ? 262144 : 131072;
      (entry.options as Record<string, unknown>).context = context;
    }
    return entry;
  });

  return {
    name: "Hooman",
    providers: [
      {
        name: displayName,
        provider: input.provider,
        options: providerOptions,
      },
    ],
    llms,
    search,
    prompts: {
      behaviour: true,
      communication: true,
      execution: true,
      guardrails: true,
    },
    tools: {
      todo: { enabled: true },
      fetch: { enabled: true },
      filesystem: { enabled: true },
      shell: { enabled: true },
      sleep: { enabled: true },
      browser: { enabled: true },
      subagents: { enabled: true },
    },
    compaction: { ratio: 0.75, keep: 5 },
    reasoning: "collapsed",
  };
}

function uniqueLlmName(
  displayName: string,
  id: string,
  used: Set<string>,
): string {
  const base = displayName.trim() || id;
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  const withId = `${base} (${id})`;
  if (!used.has(withId)) {
    used.add(withId);
    return withId;
  }
  let n = 2;
  while (used.has(`${base} (${n})`)) {
    n += 1;
  }
  const name = `${base} (${n})`;
  used.add(name);
  return name;
}

function buildProviderOptions(input: OnboardingInput): Record<string, unknown> {
  const opts: Record<string, unknown> = {};
  const raw = input.providerOptions;

  switch (input.provider) {
    case "llama-cpp":
      break;
    case "mlx":
      opts.promptCache = {};
      break;
    case "ollama": {
      const baseURL = raw.baseURL?.trim();
      if (baseURL) {
        opts.baseURL = baseURL;
      }
      break;
    }
    case "azure": {
      const baseURL = raw.baseURL?.trim();
      const apiKey = raw.apiKey?.trim();
      if (baseURL) {
        opts.baseURL = baseURL;
      }
      if (apiKey) {
        opts.apiKey = apiKey;
      }
      break;
    }
    case "bedrock": {
      const region = raw.region?.trim() || "us-west-2";
      const profile = raw.profile?.trim() || "default";
      opts.region = region;
      opts.profile = profile;
      break;
    }
    default: {
      const apiKey = raw.apiKey?.trim();
      if (apiKey) {
        opts.apiKey = apiKey;
      }
      break;
    }
  }
  return opts;
}

function buildSearchBlock(
  provider: OnboardingSearchProvider,
  options: Record<string, string>,
): Record<string, unknown> {
  const block: Record<string, unknown> = {
    enabled: true,
    provider,
    brave: {},
    duckduckgo: {},
    exa: {},
    firecrawl: {},
    litellm: {},
    serper: {},
    tavily: {},
  };

  if (provider === "duckduckgo") {
    return block;
  }

  if (provider === "litellm") {
    block.litellm = {
      ...(options.baseURL?.trim() ? { baseURL: options.baseURL.trim() } : {}),
      ...(options.apiKey?.trim() ? { apiKey: options.apiKey.trim() } : {}),
      ...(options.tool?.trim() ? { tool: options.tool.trim() } : {}),
    };
    return block;
  }

  const apiKey = options.apiKey?.trim();
  if (apiKey) {
    block[provider] = { apiKey };
  }
  return block;
}
