import type { OpenAIModelOptions } from "@strands-agents/sdk/models/openai";
import OpenAI from "openai";
import { normalizeBitfrostClientBaseURL } from "./bitfrost-base-url.js";
import { patchOpenAIClientChatCompletionsForUsage } from "../openai/openai-stream-shims.js";
import { StrandsBitfrostModel } from "./strands-bitfrost.js";

export { StrandsBitfrostModel } from "./strands-bitfrost.js";
export { normalizeBitfrostClientBaseURL } from "./bitfrost-base-url.js";

export type BitfrostModelConfig = Omit<OpenAIModelOptions, "api" | "modelId">;

/**
 * Strands {@link Model} for a Bitfrost OpenAI-compatible HTTP API.
 * Set `clientConfig.baseURL` to the gateway origin only (e.g. `http://localhost:8080`); `/openai/v1`
 * is appended automatically. Same `params` shape as **OpenAI** otherwise.
 */
export function create(
  model: string,
  params: Record<string, unknown>,
): StrandsBitfrostModel {
  const merged = { ...(params as BitfrostModelConfig) };
  const cc = merged.clientConfig as { baseURL?: string } | undefined;
  if (cc && typeof cc.baseURL === "string" && cc.baseURL.length > 0) {
    merged.clientConfig = {
      ...cc,
      baseURL: normalizeBitfrostClientBaseURL(cc.baseURL),
    };
  }
  const modelInstance = new StrandsBitfrostModel({
    api: "chat",
    modelId: model,
    ...merged,
  });
  const client = (modelInstance as unknown as { _client: OpenAI })._client;
  patchOpenAIClientChatCompletionsForUsage(client);
  return modelInstance;
}
