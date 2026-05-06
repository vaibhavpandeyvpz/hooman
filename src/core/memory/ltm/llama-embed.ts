import {
  getLlama,
  resolveModelFile,
  LlamaLogLevel,
  type Llama,
  type LlamaEmbeddingContext,
  type LlamaModel,
} from "node-llama-cpp";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  statSync,
  unlinkSync,
} from "node:fs";

const GGUF_MAGIC = Buffer.from("GGUF");

function validateGgufFile(filePath: string, modelUri: string): void {
  if (!existsSync(filePath)) {
    return;
  }
  const fd = openSync(filePath, "r");
  const sniff = Buffer.alloc(512);
  try {
    readSync(fd, sniff, 0, 512, 0);
  } finally {
    closeSync(fd);
  }
  const header = sniff.subarray(0, 4);
  if (header.equals(GGUF_MAGIC)) {
    return;
  }
  const text = sniff.toString("utf-8").toLowerCase();
  const isHtml = text.includes("<!doctype") || text.includes("<html");
  const got = header.toString("utf-8");
  const sizeKB = (statSync(filePath).size / 1024).toFixed(0);
  unlinkSync(filePath);
  if (isHtml) {
    throw new Error(
      `Downloaded LTM embed model is an HTML page, not GGUF (${sizeKB} KB).\n` +
        `Model: ${modelUri}\nPath: ${filePath}`,
    );
  }
  throw new Error(
    `LTM embed model is not valid GGUF (expected "GGUF", got "${got}", ${sizeKB} KB).\n` +
      `Model: ${modelUri}`,
  );
}

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

type LlamaGpuMode = "auto" | "metal" | "vulkan" | "cuda" | false;

function resolveLlamaGpuMode(): LlamaGpuMode {
  if (process.env.CI) {
    return false;
  }
  const raw =
    process.env.HOOMAN_LTM_LLAMA_GPU?.trim() ||
    process.env.QMD_LLAMA_GPU?.trim() ||
    "";
  const normalized = raw.toLowerCase();
  if (!normalized) {
    return "auto";
  }
  if (
    ["false", "off", "none", "disable", "disabled", "0"].includes(normalized)
  ) {
    return false;
  }
  if (
    normalized === "metal" ||
    normalized === "vulkan" ||
    normalized === "cuda"
  ) {
    return normalized;
  }
  return "auto";
}

function resolveEmbedContextSize(): number {
  const v = Number.parseInt(
    process.env.HOOMAN_LTM_EMBED_CONTEXT_SIZE ?? "",
    10,
  );
  if (Number.isFinite(v) && v > 0) {
    return v;
  }
  return 2048;
}

const EMBED_CONTEXT_SIZE = resolveEmbedContextSize();

export type LtmLlamaEmbedderOptions = {
  modelUri: string;
  cacheDir: string;
};

/**
 * Lazy local GGUF embeddings (node-llama-cpp), matching QMD formatting rules.
 */
export class LtmLlamaEmbedder {
  private readonly modelUri: string;
  private readonly cacheDir: string;
  private llama: Llama | null = null;
  private model: LlamaModel | null = null;
  private context: LlamaEmbeddingContext | null = null;
  private loadPromise: Promise<void> | null = null;

  public constructor(options: LtmLlamaEmbedderOptions) {
    this.modelUri = options.modelUri;
    this.cacheDir = options.cacheDir;
  }

  public get resolvedModelUri(): string {
    return this.modelUri;
  }

  /** Load GGUF + embedding context (no forward pass). Call at agent startup to avoid blocking tools. */
  public async warmup(): Promise<void> {
    await this.ensureLoaded();
  }

  private async ensureLoaded(): Promise<void> {
    if (this.context) {
      return;
    }
    if (this.loadPromise) {
      await this.loadPromise;
      return;
    }
    this.loadPromise = (async () => {
      if (!existsSync(this.cacheDir)) {
        mkdirSync(this.cacheDir, { recursive: true });
      }
      const modelPath = await resolveModelFile(this.modelUri, this.cacheDir);
      validateGgufFile(modelPath, this.modelUri);

      const gpuMode = resolveLlamaGpuMode();
      const loadLlama = async (gpu: LlamaGpuMode) =>
        getLlama({
          build: "never",
          logLevel: LlamaLogLevel.error,
          gpu,
        });

      let llama: Llama;
      if (gpuMode === false) {
        llama = await loadLlama(false);
      } else {
        try {
          llama = await loadLlama(gpuMode);
        } catch {
          llama = await loadLlama(false);
        }
      }
      this.llama = llama;
      const model = await llama.loadModel({ modelPath });
      this.model = model;
      const trained = model.trainContextSize;
      const contextSize =
        typeof trained === "number" && Number.isFinite(trained) && trained > 0
          ? Math.max(1, Math.min(EMBED_CONTEXT_SIZE, trained))
          : EMBED_CONTEXT_SIZE;
      this.context = await model.createEmbeddingContext({ contextSize });
    })();
    try {
      await this.loadPromise;
    } finally {
      this.loadPromise = null;
    }
  }

  private resolveEmbedTokenLimit(): number {
    const trained = this.model?.trainContextSize;
    if (
      typeof trained === "number" &&
      Number.isFinite(trained) &&
      trained > 0
    ) {
      return Math.max(1, Math.min(EMBED_CONTEXT_SIZE, trained));
    }
    return EMBED_CONTEXT_SIZE;
  }

  private truncateToContextSize(text: string): string {
    if (!this.model) {
      return text;
    }
    const maxTokens = this.resolveEmbedTokenLimit();
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

  public async embedQuery(query: string): Promise<Float32Array> {
    await this.ensureLoaded();
    if (!this.context || !this.model) {
      throw new Error("LTM embed context not initialized");
    }
    const formatted = formatQueryForEmbedding(query, this.modelUri);
    const safe = this.truncateToContextSize(formatted);
    const result = await this.context.getEmbeddingFor(safe);
    return new Float32Array(result.vector);
  }

  public async embedDocument(content: string): Promise<Float32Array> {
    await this.ensureLoaded();
    if (!this.context || !this.model) {
      throw new Error("LTM embed context not initialized");
    }
    const formatted = formatDocForEmbedding(content, undefined, this.modelUri);
    const safe = this.truncateToContextSize(formatted);
    const result = await this.context.getEmbeddingFor(safe);
    return new Float32Array(result.vector);
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
