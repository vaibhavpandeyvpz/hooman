import { OpenAIModel } from "@strands-agents/sdk/models/openai";
import type { OpenAIModelOptions } from "@strands-agents/sdk/models/openai";
import type { ClientOptions } from "openai";
import type { LlmOptions, OpenAIProviderOptions } from "./types.js";

export type OpenAIModelParams = OpenAIProviderOptions & LlmOptions;

export function create(
  providerOptions: OpenAIProviderOptions,
  llmOptions: LlmOptions,
): OpenAIModel {
  const clientConfig: ClientOptions | undefined =
    providerOptions.baseURL || providerOptions.headers
      ? {
          ...(providerOptions.baseURL
            ? { baseURL: providerOptions.baseURL }
            : {}),
          ...(providerOptions.headers
            ? { defaultHeaders: providerOptions.headers }
            : {}),
        }
      : undefined;
  const api = providerOptions.api ?? "responses";
  // On the Responses API, reasoning summaries only stream when a `reasoning`
  // param is sent. `summary` defaults to `auto`; `none` opts out entirely (for
  // non-reasoning models that reject the parameter). The Chat Completions API
  // has no equivalent, so we never attach reasoning there.
  const params = ((): Record<string, unknown> | undefined => {
    if (api !== "responses") {
      return undefined;
    }
    const summary = providerOptions.reasoning?.summary ?? "auto";
    const reasoning: Record<string, string> = {};
    if (providerOptions.reasoning?.effort) {
      reasoning.effort = providerOptions.reasoning.effort;
    }
    if (summary !== "none") {
      reasoning.summary = summary;
    }
    return Object.keys(reasoning).length > 0 ? { reasoning } : undefined;
  })();
  return new OpenAIModel({
    api,
    modelId: llmOptions.model,
    ...(providerOptions.apiKey ? { apiKey: providerOptions.apiKey } : {}),
    ...(clientConfig ? { clientConfig } : {}),
    ...(llmOptions.temperature !== undefined
      ? { temperature: llmOptions.temperature }
      : {}),
    ...(llmOptions.maxTokens !== undefined
      ? { maxTokens: llmOptions.maxTokens }
      : {}),
    ...(params ? { params } : {}),
  } as OpenAIModelOptions);
}
