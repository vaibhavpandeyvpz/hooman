import type { BedrockRuntimeClientConfig } from "@aws-sdk/client-bedrock-runtime";
import { BedrockModel } from "@strands-agents/sdk/models/bedrock";
import type { BedrockModelOptions } from "@strands-agents/sdk";
import type { BedrockProviderOptions, LlmOptions } from "./types.js";

export type BedrockLlmParams = BedrockProviderOptions & LlmOptions;

export function create(
  providerOptions: BedrockProviderOptions,
  llmOptions: LlmOptions,
): BedrockModel {
  const clientConfig: BedrockRuntimeClientConfig = {};
  if (providerOptions.accessKeyId && providerOptions.secretAccessKey) {
    clientConfig.credentials = {
      accessKeyId: providerOptions.accessKeyId,
      secretAccessKey: providerOptions.secretAccessKey,
      ...(providerOptions.sessionToken
        ? { sessionToken: providerOptions.sessionToken }
        : {}),
    };
  }
  return new BedrockModel({
    modelId: llmOptions.model,
    region: providerOptions.region ?? "us-west-2",
    ...(Object.keys(clientConfig).length > 0 ? { clientConfig } : {}),
    ...(providerOptions.apiKey !== undefined
      ? { apiKey: providerOptions.apiKey }
      : {}),
    ...(llmOptions.temperature !== undefined
      ? { temperature: llmOptions.temperature }
      : {}),
    ...(llmOptions.maxTokens !== undefined
      ? { maxTokens: llmOptions.maxTokens }
      : {}),
  } as BedrockModelOptions);
}
