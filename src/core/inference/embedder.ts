import {
  type Llama,
  type LlamaEmbeddingContext,
  type LlamaModel,
} from "node-llama-cpp";
import { load } from "./loader.js";

export function isQwen3EmbeddingModel(modelUri: string): boolean {
  return /qwen.*embed/i.test(modelUri) || /embed.*qwen/i.test(modelUri);
}

export function formatQueryForEmbedding(
  query: string,
  modelUri?: string,
): string {
  const uri = modelUri ?? "";
  if (isQwen3EmbeddingModel(uri)) {
    return `Instruct: Retrieve relevant documents for the given query\nQuery: ${query}`;
  }
  return `task: search result | query: ${query}`;
}

export function formatDocForEmbedding(
  text: string,
  title: string | undefined,
  modelUri?: string,
): string {
  const uri = modelUri ?? "";
  if (isQwen3EmbeddingModel(uri)) {
    return title ? `${title}\n${text}` : text;
  }
  return `title: ${title || "none"} | text: ${text}`;
}

export type GgufEmbedderOptions = {
  modelUri: string;
  cacheDir: string;
};

/**
 * Local GGUF embeddings via node-llama-cpp (memory / wiki Brain-style stores).
 */
export class GgufEmbedder {
  private readonly modelUri: string;
  private readonly cacheDir: string;
  private llama: Llama | null = null;
  private model: LlamaModel | null = null;
  private context: LlamaEmbeddingContext | null = null;
  private contextSize: number = 0;

  public constructor(options: GgufEmbedderOptions) {
    this.modelUri = options.modelUri;
    this.cacheDir = options.cacheDir;
  }

  public get resolvedModelUri(): string {
    return this.modelUri;
  }

  public async warmup(): Promise<void> {
    const { llama, model, context, contextSize } = await load(
      this.cacheDir,
      this.modelUri,
    );
    this.llama = llama;
    this.context = context;
    this.model = model;
    this.contextSize = contextSize;
  }

  private truncate(text: string): string {
    if (!this.model) {
      return text;
    }
    const maxTokens = this.contextSize;
    if (maxTokens <= 0) {
      return text;
    }
    const tokens = this.model.tokenize(text);
    if (tokens.length <= maxTokens) {
      return text;
    }
    const safeLimit = Math.max(1, maxTokens - 4);
    const truncatedTokens = tokens.slice(0, safeLimit);
    return this.model.detokenize(truncatedTokens);
  }

  private async embed(str: string): Promise<Float32Array> {
    if (!this.context || !this.model) {
      throw new Error("Embed context not initialized");
    }
    const safe = this.truncate(str);
    const result = await this.context.getEmbeddingFor(safe);
    return new Float32Array(result.vector);
  }

  public async embedQuery(query: string): Promise<Float32Array> {
    return this.embed(formatQueryForEmbedding(query, this.modelUri));
  }

  public async embedDocument(
    content: string,
    title?: string,
  ): Promise<Float32Array> {
    return this.embed(formatDocForEmbedding(content, title, this.modelUri));
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
