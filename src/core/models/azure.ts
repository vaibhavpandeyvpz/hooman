import { createAzure, azure } from "@ai-sdk/azure";
import type { AzureOpenAIProviderSettings } from "@ai-sdk/azure";
import { VercelModel } from "@strands-agents/sdk/models/vercel";
import type { VercelModelConfig } from "@strands-agents/sdk/models/vercel";
import type { AzureProviderOptions, LlmOptions } from "./types.js";

export type AzureModelParams = AzureProviderOptions & LlmOptions;

export function create(
  providerOptions: AzureProviderOptions,
  llmOptions: LlmOptions,
): VercelModel {
  const settings = Object.fromEntries(
    Object.entries({
      resourceName: providerOptions.resourceName,
      baseURL: providerOptions.baseURL,
      apiKey: providerOptions.apiKey,
      headers: providerOptions.headers,
      apiVersion: providerOptions.apiVersion,
      useDeploymentBasedUrls: providerOptions.useDeploymentBasedUrls,
    }).filter((entry) => entry[1] !== undefined),
  ) as AzureOpenAIProviderSettings;
  const provider =
    Object.keys(settings).length > 0 ? createAzure(settings) : azure;
  // Azure OpenAI (Responses API) reads reasoning from `providerOptions.azure`.
  // Only reasoning-capable deployments honor these; others ignore them.
  const azureOptions: Record<string, string> = {};
  if (providerOptions.reasoning?.effort) {
    azureOptions.reasoningEffort = providerOptions.reasoning.effort;
  }
  const summary = providerOptions.reasoning?.summary;
  if (summary !== undefined && summary !== "none") {
    azureOptions.reasoningSummary = summary;
  }
  const config: Partial<VercelModelConfig> = {
    ...(llmOptions.temperature !== undefined
      ? { temperature: llmOptions.temperature }
      : {}),
    ...(llmOptions.maxTokens !== undefined
      ? { maxTokens: llmOptions.maxTokens }
      : {}),
    ...(Object.keys(azureOptions).length > 0
      ? { providerOptions: { azure: azureOptions } }
      : {}),
  };
  return new VercelModel({
    provider: provider(llmOptions.model),
    ...config,
  });
}
