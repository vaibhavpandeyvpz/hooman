import type { GgufEmbedder } from "./embedder.js";

export {
  GgufEmbedder,
  type GgufEmbedderOptions,
  formatDocForEmbedding,
  formatQueryForEmbedding,
  isQwen3EmbeddingModel,
} from "./embedder.js";
export { GgufReranker, type GgufRerankerOptions } from "./reranker.js";
export type { LlamaGpuMode } from "./loader.js";

/**
 * Produce an embedding vector (same numeric space as stored memories).
 * Pass `mode: "query"` for search queries; default embeds like a document.
 */
export async function embed(
  embedder: GgufEmbedder,
  text: string,
  mode: "document" | "query" = "document",
): Promise<number[]> {
  const v =
    mode === "query"
      ? await embedder.embedQuery(text)
      : await embedder.embedDocument(text);
  return Array.from(v);
}
