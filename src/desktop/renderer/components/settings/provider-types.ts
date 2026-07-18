/**
 * Provider type ids/labels for the Settings UI. Keep aligned with
 * `LlmProvider` in `core/models/types.ts` — this file must stay dependency-
 * free (no `hoomanjs`/Node imports) since it's bundled into the renderer.
 */
export const PROVIDER_TYPES = [
  "anthropic",
  "azure",
  "bedrock",
  "google",
  "groq",
  "llama-cpp",
  "minimax",
  "mlx",
  "moonshot",
  "ollama",
  "openai",
  "openrouter",
  "xai",
] as const;

export type ProviderType = (typeof PROVIDER_TYPES)[number];

export const PROVIDER_LABELS: Record<ProviderType, string> = {
  anthropic: "Anthropic",
  azure: "Azure OpenAI",
  bedrock: "Bedrock",
  google: "Google",
  groq: "Groq",
  "llama-cpp": "llama.cpp",
  minimax: "MiniMax",
  mlx: "MLX",
  moonshot: "Moonshot",
  ollama: "Ollama",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  xai: "xAI",
};

/** Best-effort parse so key/value editor rows can hold numbers/booleans/objects, not just strings. */
export function parseExtraValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export function stringifyExtraValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}
