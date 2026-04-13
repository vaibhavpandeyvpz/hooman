import type { BedrockRuntimeClientConfig } from "@aws-sdk/client-bedrock-runtime";
import { BedrockModel } from "@strands-agents/sdk/models/bedrock";
import type { BedrockModelOptions } from "@strands-agents/sdk";

/**
 * Params map from `config.llm.params` into {@link BedrockModel} options.
 *
 * - **`region`**: AWS region (default `us-west-2`).
 * - **`clientConfig`**: passed to the Bedrock Runtime client (credentials, profile, etc.).
 *   See AWS SDK v3 docs for credential options.
 * - **`apiKey`**: optional Bedrock API key auth (bearer), if used instead of SigV4.
 * - Any other keys are forwarded as Bedrock model config (e.g. `maxTokens`, `temperature`,
 *   `stream`, `cacheConfig`).
 *
 * `config.llm.model` is always used as `modelId`.
 */
export type BedrockLlmParams = Omit<
  BedrockModelOptions,
  "modelId" | "region" | "clientConfig" | "apiKey"
> & {
  region?: string;
  clientConfig?: BedrockRuntimeClientConfig;
  apiKey?: string;
};

const TOP_LEVEL_KEYS = new Set(["region", "clientConfig", "apiKey", "modelId"]);

export function create(
  model: string,
  params: Record<string, unknown> = {},
): BedrockModel {
  const p = params as Record<string, unknown>;
  const region =
    typeof p.region === "string" && p.region.length > 0
      ? p.region
      : "us-west-2";
  const clientConfig = p.clientConfig as BedrockRuntimeClientConfig | undefined;
  const apiKey = typeof p.apiKey === "string" ? p.apiKey : undefined;

  const modelOptions: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(p)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      modelOptions[key] = value;
    }
  }

  return new BedrockModel({
    modelId: model,
    region,
    ...(clientConfig ? { clientConfig } : {}),
    ...(apiKey !== undefined ? { apiKey } : {}),
    ...modelOptions,
  } as BedrockModelOptions);
}
