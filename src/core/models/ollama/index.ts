import type { OllamaModelConfig } from "./strands-ollama.js";
import { StrandsOllamaModel } from "./strands-ollama.js";

/** Strands {@link Model} backed by local (or remote) Ollama via `ollama` JS. */
export function create(
  model: string,
  params: Record<string, any>,
): StrandsOllamaModel {
  const maxTokens =
    typeof params.maxTokens === "number" && Number.isFinite(params.maxTokens)
      ? params.maxTokens
      : 64_000;

  return new StrandsOllamaModel({
    modelId: model,
    maxTokens,
    ...(params as Omit<OllamaModelConfig, "modelId">),
  });
}
