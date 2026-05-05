import type { OpenAIModelOptions } from "@strands-agents/sdk/models/openai";
import OpenAI from "openai";
import { normalizeBifrostClientBaseURL } from "./bifrost-base-url.js";
import { patchOpenAIClientChatCompletionsForUsage } from "../openai/openai-stream-shims.js";
import { StrandsBifrostModel } from "./strands-bifrost.js";

export { StrandsBifrostModel } from "./strands-bifrost.js";
export { normalizeBifrostClientBaseURL } from "./bifrost-base-url.js";

export type BifrostModelConfig = Omit<OpenAIModelOptions, "api" | "modelId">;

/**
 * Strands {@link Model} for a Bifrost OpenAI-compatible HTTP API.
 * Set `clientConfig.baseURL` to the gateway origin only (e.g. `http://localhost:8080`); `/openai/v1`
 * is appended automatically. Same `params` shape as **OpenAI** otherwise.
 */
export function create(
  model: string,
  params: Record<string, unknown>,
): StrandsBifrostModel {
  const merged = { ...(params as BifrostModelConfig) };
  const cc = merged.clientConfig as { baseURL?: string } | undefined;
  if (cc && typeof cc.baseURL === "string" && cc.baseURL.length > 0) {
    merged.clientConfig = {
      ...cc,
      baseURL: normalizeBifrostClientBaseURL(cc.baseURL),
    };
  }
  const modelInstance = new StrandsBifrostModel({
    api: "chat",
    modelId: model,
    ...merged,
  });
  const client = (modelInstance as unknown as { _client: OpenAI })._client;
  patchOpenAIClientChatCompletionsForUsage(client);
  return modelInstance;
}
