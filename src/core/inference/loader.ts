import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  statSync,
  unlinkSync,
} from "node:fs";
import {
  getLlama,
  resolveModelFile,
  LlamaLogLevel,
  type Llama,
  type LlamaEmbeddingContext,
  type LlamaModel,
} from "node-llama-cpp";

export type RankingContext = Awaited<
  ReturnType<LlamaModel["createRankingContext"]>
>;

const DEFAULT_EMBED_CONTEXT_SIZE = 2048;
const DEFAULT_RERANK_CONTEXT_SIZE = 4096;
export const RERANK_TEMPLATE_OVERHEAD = 512;

const GGUF_MAGIC = Buffer.from("GGUF");

export type LlamaGpuMode = "auto" | "metal" | "vulkan" | "cuda" | false;

function gpu(): LlamaGpuMode {
  if (process.env.CI) {
    return false;
  }
  const raw = process.env.HOOMAN_LLAMA_GPU?.trim() ?? "";
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

function maxTokensForEmbed(): number {
  const raw = process.env.HOOMAN_EMBED_CONTEXT_SIZE?.trim() ?? "";
  const v = Number.parseInt(raw, 10);
  if (Number.isFinite(v) && v > 0) {
    return v;
  }
  return DEFAULT_EMBED_CONTEXT_SIZE;
}

function maxTokensForRerank(): number {
  const raw = process.env.HOOMAN_RERANK_CONTEXT_SIZE?.trim() ?? "";
  const v = Number.parseInt(raw, 10);
  if (Number.isFinite(v) && v > 0) return v;
  return DEFAULT_RERANK_CONTEXT_SIZE;
}

function validate(file: string, uri: string): void {
  if (!existsSync(file)) {
    return;
  }
  const fd = openSync(file, "r");
  const sniff = Buffer.alloc(512);
  try {
    readSync(fd, sniff, 0, 512, 0);
  } finally {
    closeSync(fd);
  }
  const header = sniff.subarray(0, 4);
  if (!header.equals(GGUF_MAGIC)) {
    const got = header.toString("utf-8");
    const sizeKb = (statSync(file).size / 1024).toFixed(0);
    unlinkSync(file);
    throw new Error(
      `Embed model is not valid GGUF (expected "GGUF", got "${got}", ${sizeKb} KB).\n` +
        `Model: ${uri}`,
    );
  }
}

export async function loadEmbedder(
  dir: string,
  uri: string,
): Promise<{
  llama: Llama;
  model: LlamaModel;
  context: LlamaEmbeddingContext;
  contextSize: number;
}> {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const file = await resolveModelFile(uri, dir);
  validate(file, uri);

  const mode = gpu();
  const loadLlama = async (gpu: LlamaGpuMode) =>
    getLlama({
      build: "never",
      logLevel: LlamaLogLevel.error,
      gpu,
    });

  let llama: Llama;
  if (mode === false) {
    llama = await loadLlama(false);
  } else {
    try {
      llama = await loadLlama(mode);
    } catch {
      llama = await loadLlama(false);
    }
  }
  const model = await llama.loadModel({ modelPath: file });
  const trained = model.trainContextSize;
  const tokens = maxTokensForEmbed();
  const contextSize =
    typeof trained === "number" && Number.isFinite(trained) && trained > 0
      ? Math.max(1, Math.min(tokens, trained))
      : tokens;
  const context = await model.createEmbeddingContext({ contextSize });
  return { llama, model, context, contextSize };
}

export async function loadReranker(
  dir: string,
  uri: string,
): Promise<{
  llama: Llama;
  model: LlamaModel;
  context: RankingContext;
  contextSize: number;
}> {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const file = await resolveModelFile(uri, dir);
  validate(file, uri);

  const mode = gpu();
  const loadLlama = async (gpuMode: LlamaGpuMode) =>
    getLlama({ build: "never", logLevel: LlamaLogLevel.error, gpu: gpuMode });

  let llama: Llama;
  if (mode === false) {
    llama = await loadLlama(false);
  } else {
    try {
      llama = await loadLlama(mode);
    } catch {
      llama = await loadLlama(false);
    }
  }

  const model = await llama.loadModel({ modelPath: file });
  const ctxSize = maxTokensForRerank();
  let context: RankingContext;
  try {
    context = await model.createRankingContext({
      contextSize: ctxSize,
      flashAttention: true,
    } as Parameters<LlamaModel["createRankingContext"]>[0]);
  } catch {
    context = await model.createRankingContext({ contextSize: ctxSize });
  }
  return { llama, model, context, contextSize: ctxSize };
}
