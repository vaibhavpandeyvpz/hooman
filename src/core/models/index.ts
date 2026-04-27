import type { Model, BaseModelConfig } from "@strands-agents/sdk";

export type ModelProvider = {
  create: (
    model: string,
    params: Record<string, any>,
  ) => Model<BaseModelConfig>;
};

export const modelProviders: Record<string, () => Promise<ModelProvider>> = {
  anthropic: () => import("./anthropic.js"),
  bedrock: () => import("./bedrock.js"),
  google: () => import("./google.js"),
  groq: () => import("./groq.js"),
  moonshot: () => import("./moonshot.js"),
  ollama: () => import("./ollama/index.js"),
  openai: () => import("./openai.js"),
  xai: () => import("./xai.js"),
};
