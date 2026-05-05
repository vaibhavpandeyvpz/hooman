import type { ClientOptions } from "@anthropic-ai/sdk";
import { AnthropicModel } from "@strands-agents/sdk/models/anthropic";
import type { AnthropicModelOptions } from "@strands-agents/sdk/models/anthropic";

/** Config JSON / provider params (`modelId` is set by {@link create}; no injected `client`). */
export type AnthropicModelParams = Omit<AnthropicModelOptions, "modelId" | "client">;

const RESERVED = new Set([
  "apiKey",
  "authToken",
  "baseURL",
  "headers",
  "client",
  "clientConfig",
]);

function pickModelOptions(
  params: Record<string, unknown>,
): Omit<AnthropicModelParams, "apiKey" | "clientConfig"> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (!RESERVED.has(k)) {
      out[k] = v;
    }
  }
  return out as Omit<AnthropicModelParams, "apiKey" | "clientConfig">;
}

function resolveApiKey(params: Record<string, unknown>): string | undefined {
  const k = params.apiKey;
  const t = params.authToken;
  if (typeof k === "string" && k.length > 0) {
    return k;
  }
  if (typeof t === "string" && t.length > 0) {
    return t;
  }
  return undefined;
}

function mergeClientConfig(
  params: Record<string, unknown>,
): ClientOptions | undefined {
  const explicit = params.clientConfig as ClientOptions | undefined;
  const baseURL =
    typeof params.baseURL === "string" && params.baseURL.length > 0
      ? params.baseURL
      : undefined;
  const headers = params.headers;
  const defaultHeaders =
    headers &&
    typeof headers === "object" &&
    headers !== null &&
    !Array.isArray(headers)
      ? (headers as Record<string, string | undefined>)
      : undefined;

  if (!explicit && !baseURL && !defaultHeaders) {
    return undefined;
  }

  return {
    ...explicit,
    ...(baseURL ? { baseURL } : {}),
    ...(defaultHeaders
      ? {
          defaultHeaders: {
            ...explicit?.defaultHeaders,
            ...defaultHeaders,
          },
        }
      : {}),
  };
}

/**
 * Anthropic via Strands {@link AnthropicModel} (Messages API).
 *
 * - **`config.llm.model`**: Claude model id (e.g. `claude-sonnet-4-20250514`).
 * - **`params`**: `apiKey` or `authToken`, optional `baseURL` / `headers` (merged into `clientConfig`),
 *   optional `clientConfig`, plus model fields (`temperature`, `maxTokens`, `topP`, `stopSequences`, `params`, …).
 *   If no key is set, `ANTHROPIC_API_KEY` is used.
 */
export function create(
  model: string,
  params: Record<string, unknown> = {},
): AnthropicModel {
  const apiKey = resolveApiKey(params);
  const clientConfig = mergeClientConfig(params);
  const modelOpts = pickModelOptions(params);

  return new AnthropicModel({
    modelId: model,
    ...(apiKey ? { apiKey } : {}),
    ...(clientConfig && Object.keys(clientConfig).length > 0
      ? { clientConfig }
      : {}),
    ...modelOpts,
  });
}
