import { pipeline } from "@huggingface/transformers";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import type { EmbeddingFunction } from "chromadb";

const DEFAULT_MODEL =
  process.env.HF_EMBEDDING_MODEL ?? "Xenova/bge-small-en-v1.5";

/**
 * Chroma {@link EmbeddingFunction} backed by `@huggingface/transformers`
 * `feature-extraction` (mean-pooled, L2-normalized sentence embeddings).
 *
 * The pipeline is loaded lazily on first {@link HFEmbedding.generate} call so
 * constructors stay synchronous and startup stays fast.
 */
export class HFEmbedding implements EmbeddingFunction {
  private readonly modelId: string;
  private pipePromise: Promise<FeatureExtractionPipeline> | null = null;

  constructor(modelId: string = DEFAULT_MODEL) {
    this.modelId = modelId;
  }

  get name(): string {
    return `hf-transformers:${this.modelId}`;
  }

  private async getPipeline(): Promise<FeatureExtractionPipeline> {
    if (!this.pipePromise) {
      this.pipePromise = pipeline(
        "feature-extraction",
        this.modelId,
      ) as Promise<FeatureExtractionPipeline>;
    }
    return this.pipePromise;
  }

  async generate(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    const pipe = await this.getPipeline();
    const tensor = await pipe(texts, {
      pooling: "mean",
      normalize: true,
    });
    const raw = tensor.tolist() as unknown;

    if (texts.length === 1) {
      if (Array.isArray(raw) && raw.every((x) => typeof x === "number")) {
        return [raw as number[]];
      }
    }

    if (
      Array.isArray(raw) &&
      raw.length > 0 &&
      Array.isArray(raw[0]) &&
      (raw[0] as unknown[]).every((x) => typeof x === "number")
    ) {
      return raw as number[][];
    }

    throw new Error(
      "Unexpected embedding tensor shape from feature-extraction pipeline",
    );
  }
}
