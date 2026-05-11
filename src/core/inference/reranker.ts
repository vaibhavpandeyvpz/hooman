import type { Llama, LlamaModel } from "node-llama-cpp";
import {
  loadReranker,
  type RankingContext,
  RERANK_TEMPLATE_OVERHEAD,
} from "./loader.js";

export type GgufRerankerOptions = {
  modelUri: string;
  cacheDir: string;
};

/**
 * Local GGUF reranker via node-llama-cpp using a Qwen3-Reranker model.
 * Lazy-loads on first use — the model (~600 MB) is only downloaded and loaded
 * when reranking is actually triggered.
 */
export class GgufReranker {
  private readonly modelUri: string;
  private readonly cacheDir: string;
  private llama: Llama | null = null;
  private model: LlamaModel | null = null;
  private context: RankingContext | null = null;
  private contextSize: number = 0;
  private loadPromise: Promise<void> | null = null;

  public constructor(options: GgufRerankerOptions) {
    this.modelUri = options.modelUri;
    this.cacheDir = options.cacheDir;
  }

  public async warmup(): Promise<void> {
    const { llama, model, context, contextSize } = await loadReranker(
      this.cacheDir,
      this.modelUri,
    );
    this.llama = llama;
    this.context = context;
    this.model = model;
    this.contextSize = contextSize;
  }

  private truncate(text: string, maxTokens: number): string {
    if (!this.model || maxTokens <= 0) return text;
    const tokens = this.model.tokenize(text);
    if (tokens.length <= maxTokens) return text;
    const safe = Math.max(1, maxTokens);
    return this.model.detokenize(tokens.slice(0, safe));
  }

  /**
   * Rerank documents by relevance to query using the local Qwen3-Reranker model.
   * Returns the input array re-ordered from most to least relevant.
   * Falls back to original order if the model is unavailable.
   */
  public async rerank<T>(
    query: string,
    docs: T[],
    getText: (doc: T) => string,
  ): Promise<T[]> {
    if (docs.length === 0) return docs;

    if (!this.context || !this.model) return docs;

    const queryTokens = this.model.tokenize(query).length;
    const maxDocTokens =
      this.contextSize - RERANK_TEMPLATE_OVERHEAD - queryTokens;

    const texts = docs.map((doc) => this.truncate(getText(doc), maxDocTokens));
    const scores: number[] = await this.context.rankAll(query, texts);

    return docs
      .map((doc, i) => ({ doc, score: scores[i] ?? -Infinity }))
      .sort((a, b) => b.score - a.score)
      .map(({ doc }) => doc);
  }

  public async dispose(): Promise<void> {
    if (this.context) {
      await this.context.dispose();
      this.context = null;
    }
    if (this.model) {
      await this.model.dispose();
      this.model = null;
    }
    this.llama = null;
  }
}
