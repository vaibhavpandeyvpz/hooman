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

function maxTokens(): number {
  const raw = process.env.HOOMAN_EMBED_CONTEXT_SIZE?.trim() ?? "";
  const v = Number.parseInt(raw, 10);
  if (Number.isFinite(v) && v > 0) {
    return v;
  }
  return 2048;
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

export async function load(
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
  const tokens = maxTokens();
  const contextSize =
    typeof trained === "number" && Number.isFinite(trained) && trained > 0
      ? Math.max(1, Math.min(tokens, trained))
      : tokens;
  const context = await model.createEmbeddingContext({ contextSize });
  return { llama, model, context, contextSize };
}
