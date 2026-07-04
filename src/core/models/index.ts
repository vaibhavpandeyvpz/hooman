import type { Model, BaseModelConfig } from "@strands-agents/sdk";
import type { LlmOptions, ProviderOptions } from "./types.js";

export type ModelProvider = {
  create(
    providerOptions: ProviderOptions,
    llmOptions: LlmOptions,
  ): Model<BaseModelConfig>;
};

export const modelProviders: Record<string, () => Promise<ModelProvider>> = {
  anthropic: () => import("./anthropic.js"),
  azure: () => import("./azure.js"),
  bedrock: () => import("./bedrock.js"),
  google: () => import("./google.js"),
  groq: () => import("./groq.js"),
  "llama-cpp": () => import("./llama-cpp/index.js"),
  minimax: () => import("./minimax.js"),
  moonshot: () => import("./moonshot.js"),
  ollama: () => import("./ollama/index.js"),
  openai: () => import("./openai.js"),
  openrouter: () => import("./openrouter.js"),
  xai: () => import("./xai.js"),
};
