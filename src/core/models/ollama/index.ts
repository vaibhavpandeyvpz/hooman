import type { OllamaModelConfig } from "./strands-ollama.ts";
import { StrandsOllamaModel } from "./strands-ollama.ts";

/** Strands {@link Model} backed by local (or remote) Ollama via `ollama` JS. */
export function create(
  model: string,
  params: Record<string, any>,
): StrandsOllamaModel {
  return new StrandsOllamaModel({
    modelId: model,
    ...(params as Omit<OllamaModelConfig, "modelId">),
  });
}
