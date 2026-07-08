import { existsSync } from "fs";
import { homedir } from "os";
import { dirname, join, sep } from "path";
import { listFiles, modelInfo } from "@huggingface/hub";
import { cachePath } from "../../utils/paths.js";
import { downloadFileWithProgress } from "../../utils/hub-download.js";

/**
 * MLX model repos are cached under `~/.hooman/cache/huggingface` (HF cache
 * layout), shared with the llama-cpp provider's GGUF downloads.
 */
export const mlxCacheDir = () => join(cachePath(), "huggingface");

export type ParsedModelSpec =
  { kind: "local"; path: string } | { kind: "hub"; repo: string };

function expandHome(p: string): string {
  if (p === "~" || p.startsWith(`~${sep}`) || p.startsWith("~/")) {
    return join(homedir(), p.slice(1));
  }
  return p;
}

/**
 * Parse an LLM `model` value into either a local MLX model directory or a
 * Hugging Face repo designation. Accepted shapes (an optional `hf:` prefix is
 * stripped):
 * - `/abs/path/to/model-dir`, `./rel/model-dir`, `~/models/model-dir`
 *   (a directory containing `config.json` + safetensors weights)
 * - `owner/repo` (an MLX-format repo, e.g. from `mlx-community`)
 */
export function parseModelSpec(model: string): ParsedModelSpec {
  const spec = (model.startsWith("hf:") ? model.slice(3) : model).trim();
  if (spec.length === 0) {
    throw new Error("MLX model is not configured");
  }
  const expanded = expandHome(spec);
  const looksLikePath =
    spec.startsWith("/") ||
    spec.startsWith("./") ||
    spec.startsWith("../") ||
    spec.startsWith("~");
  if (looksLikePath || existsSync(join(expanded, "config.json"))) {
    return { kind: "local", path: expanded };
  }
  const segments = spec.split("/").filter((s) => s.length > 0);
  if (segments.length === 2) {
    return { kind: "hub", repo: spec };
  }
  throw new Error(
    `Invalid MLX model "${model}". Use a local MLX model directory ` +
      `or an "owner/repo" Hugging Face repo (MLX format, e.g. mlx-community/...).`,
  );
}

/**
 * Repo files the MLX runtime needs: model config + weights + tokenizer
 * assets. Everything else (README, images, .gitattributes) is skipped.
 */
const MODEL_FILE_EXTENSIONS = [
  ".safetensors",
  ".json",
  ".jinja",
  ".txt",
  ".model",
];

function isModelFile(path: string): boolean {
  const lower = path.toLowerCase();
  if (lower === ".gitattributes") {
    return false;
  }
  return MODEL_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Resolve a model spec to a local MLX model directory, downloading the repo
 * (config, safetensors weights, tokenizer files) from the Hugging Face Hub
 * into the Hooman cache when needed. Weight shards are reported as shards of
 * one download via `subscribeModelDownloadProgress`; the smaller JSON/
 * tokenizer files download silently unless they exceed the reporter's
 * blob-size threshold. Returns the snapshot directory containing
 * `config.json`, which `mlex.js`'s `MlexModel.load` consumes directly.
 */
export async function resolveModelDir(
  model: string,
  hfToken?: string,
): Promise<string> {
  const parsed = parseModelSpec(model);
  if (parsed.kind === "local") {
    if (!existsSync(join(parsed.path, "config.json"))) {
      throw new Error(
        `MLX model directory not found (no config.json): ${parsed.path}`,
      );
    }
    return parsed.path;
  }
  const accessToken = hfToken?.trim() || process.env.HF_TOKEN?.trim();
  const credentials = accessToken ? { accessToken } : {};
  const cacheDir = mlxCacheDir();

  // Pin every file to the repo's current head commit: the HF cache layout
  // names snapshot dirs after the revision each file resolved to, so
  // un-pinned multi-file downloads would scatter across snapshot dirs and
  // never form one complete model directory.
  const info = await modelInfo({
    name: parsed.repo,
    additionalFields: ["sha"],
    ...(accessToken ? { accessToken } : {}),
  });
  const revision = info.sha;
  if (typeof revision !== "string" || revision.length === 0) {
    throw new Error(
      `Cannot resolve the current revision of Hugging Face repo "${parsed.repo}".`,
    );
  }

  const files: string[] = [];
  for await (const entry of listFiles({
    repo: parsed.repo,
    recursive: true,
    revision,
    ...(accessToken ? { accessToken } : {}),
  })) {
    if (entry.type === "file" && isModelFile(entry.path)) {
      files.push(entry.path);
    }
  }
  if (!files.includes("config.json")) {
    throw new Error(
      `Hugging Face repo "${parsed.repo}" does not look like an MLX model ` +
        `(no config.json). Use an MLX-format repo, e.g. from mlx-community.`,
    );
  }
  const weights = files.filter((f) => f.toLowerCase().endsWith(".safetensors"));
  if (weights.length === 0) {
    throw new Error(
      `No .safetensors weights found in Hugging Face repo "${parsed.repo}".`,
    );
  }

  // Small metadata files first (cheap, near-instant), then the weight shards
  // with shard-indexed progress so the UI shows "shard i of n".
  const metadata = files.filter(
    (f) => !f.toLowerCase().endsWith(".safetensors"),
  );
  let configPath: string | undefined;
  for (const filePath of metadata.sort()) {
    const local = await downloadFileWithProgress({
      repo: parsed.repo,
      filePath,
      cacheDir,
      credentials,
      model,
      revision,
    });
    if (filePath === "config.json") {
      configPath = local;
    }
  }
  weights.sort();
  for (let i = 0; i < weights.length; i++) {
    await downloadFileWithProgress({
      repo: parsed.repo,
      filePath: weights[i]!,
      cacheDir,
      credentials,
      model,
      revision,
      ...(weights.length > 1
        ? { shard: { index: i + 1, total: weights.length } }
        : {}),
    });
  }
  return dirname(configPath!);
}
