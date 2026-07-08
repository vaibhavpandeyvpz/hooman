import { existsSync } from "fs";
import { homedir } from "os";
import { isAbsolute, join, sep } from "path";
import { listFiles } from "@huggingface/hub";
import { cachePath } from "../../utils/paths.js";
import { downloadFileWithProgress } from "../../utils/hub-download.js";

/** GGUF files are cached under `~/.hooman/cache/huggingface` (HF cache layout). */
export const llamaCppCacheDir = () => join(cachePath(), "huggingface");

export type ParsedModelSpec =
  | { kind: "local"; path: string }
  | { kind: "hub"; repo: string; filePath?: string; quant?: string };

const SHARD_SUFFIX = /-(\d{5})-of-(\d{5})\.gguf$/i;

function expandHome(p: string): string {
  if (p === "~" || p.startsWith(`~${sep}`) || p.startsWith("~/")) {
    return join(homedir(), p.slice(1));
  }
  return p;
}

/**
 * Parse an LLM `model` value into either a local GGUF path or a Hugging Face
 * repo designation. Accepted shapes (an optional `hf:` prefix is stripped):
 * - `/abs/path/model.gguf`, `./rel/model.gguf`, `~/models/model.gguf`
 * - `owner/repo` (the repo's GGUF file is auto-detected)
 * - `owner/repo:Q4_K_M` (pick the variant matching a quant tag, llama.cpp style)
 * - `owner/repo/path/to/file.gguf` (pin an exact file, e.g. a quant variant)
 */
export function parseModelSpec(model: string): ParsedModelSpec {
  let spec = (model.startsWith("hf:") ? model.slice(3) : model).trim();
  if (spec.length === 0) {
    throw new Error("llama.cpp model is not configured");
  }
  let quant: string | undefined;
  const quantMatch = spec.match(/^([^:]+\/[^:]+):([\w.-]+)$/);
  if (quantMatch) {
    spec = quantMatch[1]!;
    quant = quantMatch[2]!;
  }
  if (spec.toLowerCase().endsWith(".gguf")) {
    const expanded = expandHome(spec);
    if (
      isAbsolute(expanded) ||
      spec.startsWith("./") ||
      spec.startsWith("../") ||
      existsSync(expanded)
    ) {
      return { kind: "local", path: expanded };
    }
  }
  const segments = spec.split("/").filter((s) => s.length > 0);
  if (segments.length >= 3 && spec.toLowerCase().endsWith(".gguf")) {
    return {
      kind: "hub",
      repo: segments.slice(0, 2).join("/"),
      filePath: segments.slice(2).join("/"),
    };
  }
  if (segments.length === 2) {
    return { kind: "hub", repo: spec, ...(quant ? { quant } : {}) };
  }
  throw new Error(
    `Invalid llama.cpp model "${model}". Use a local .gguf path, ` +
      `"owner/repo", "owner/repo:QUANT", or "owner/repo/path/to/file.gguf".`,
  );
}

/**
 * Preferred quantizations when a repo ships several GGUF variants, best
 * quality/size trade-off first. Files matching none rank after all matches.
 */
const QUANT_PREFERENCE = [
  "q4_k_m",
  "q4_k_s",
  "q4_0",
  "q5_k_m",
  "q5_0",
  "q6_k",
  "q8_0",
  "f16",
  "bf16",
];

function quantRank(filePath: string): number {
  const lower = filePath.toLowerCase();
  const index = QUANT_PREFERENCE.findIndex((quant) => lower.includes(quant));
  return index === -1 ? QUANT_PREFERENCE.length : index;
}

/**
 * Auto-detect the GGUF file to use in a Hugging Face repo. Ignores `mmproj`
 * projector and `mtp` (multi-token-prediction) companion files; for sharded
 * models returns the first shard (its siblings are downloaded alongside it).
 * With a `quant` tag (e.g. `Q4_K_M` from `owner/repo:Q4_K_M`) only files whose
 * name contains that tag are considered. Otherwise, when several distinct
 * GGUF variants exist, common quantizations are preferred (Q4_K_M first) and
 * ties break alphabetically — pin `owner/repo/file.gguf` to override.
 */
async function pickGgufFile(
  repo: string,
  accessToken: string | undefined,
  quant?: string,
): Promise<string> {
  let ggufFiles: string[] = [];
  for await (const entry of listFiles({
    repo,
    recursive: true,
    ...(accessToken ? { accessToken } : {}),
  })) {
    const lower = entry.path.toLowerCase();
    if (
      entry.type === "file" &&
      lower.endsWith(".gguf") &&
      !lower.includes("mmproj") &&
      !/(^|[/-])mtp([.-]|$)/.test(lower)
    ) {
      ggufFiles.push(entry.path);
    }
  }
  if (ggufFiles.length === 0) {
    throw new Error(`No .gguf file found in Hugging Face repo "${repo}".`);
  }
  if (quant) {
    const tag = quant.toLowerCase();
    const matches = ggufFiles.filter((f) => {
      const name = f.toLowerCase();
      // Match the tag on a word boundary (e.g. `Q8_0` should not match
      // `UD-Q8_K_XL`, and `Q4_K_M` should not match `Q4_K_M-MTP`).
      return new RegExp(
        `(^|[^a-z0-9])${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9_])`,
      ).test(name);
    });
    if (matches.length === 0) {
      throw new Error(
        `No .gguf file matching quant "${quant}" found in Hugging Face repo "${repo}".`,
      );
    }
    ggufFiles = matches;
  }
  ggufFiles.sort((a, b) => quantRank(a) - quantRank(b) || a.localeCompare(b));
  const nonShards = ggufFiles.filter((f) => !SHARD_SUFFIX.test(f));
  if (nonShards.length > 0) {
    return nonShards[0]!;
  }
  const firstShards = ggufFiles.filter((f) => {
    const m = f.match(SHARD_SUFFIX);
    return m !== null && Number(m[1]) === 1;
  });
  return firstShards[0] ?? ggufFiles[0]!;
}

/**
 * Resolve a model spec to a local GGUF file path, downloading it from the
 * Hugging Face Hub into the Hooman cache when needed. For sharded GGUFs all
 * shards are fetched and the first shard's path is returned (llama.cpp finds
 * the siblings next to it). Download progress is reported process-wide via
 * `subscribeModelDownloadProgress` (see `../download-progress.ts`).
 */
export async function resolveModelFile(
  model: string,
  hfToken?: string,
): Promise<string> {
  const parsed = parseModelSpec(model);
  if (parsed.kind === "local") {
    if (!existsSync(parsed.path)) {
      throw new Error(`llama.cpp model file not found: ${parsed.path}`);
    }
    return parsed.path;
  }
  const accessToken = hfToken?.trim() || process.env.HF_TOKEN?.trim();
  const filePath =
    parsed.filePath ??
    (await pickGgufFile(parsed.repo, accessToken, parsed.quant));
  const credentials = accessToken ? { accessToken } : {};
  const cacheDir = llamaCppCacheDir();

  const shardMatch = filePath.match(SHARD_SUFFIX);
  if (shardMatch) {
    const total = Number(shardMatch[2]);
    const prefix = filePath.slice(0, -shardMatch[0].length);
    let firstShardPath: string | undefined;
    for (let i = 1; i <= total; i++) {
      const shard = `${prefix}-${String(i).padStart(5, "0")}-of-${shardMatch[2]}.gguf`;
      const local = await downloadFileWithProgress({
        repo: parsed.repo,
        filePath: shard,
        cacheDir,
        credentials,
        model,
        shard: { index: i, total },
      });
      if (i === 1) {
        firstShardPath = local;
      }
    }
    return firstShardPath!;
  }

  return downloadFileWithProgress({
    repo: parsed.repo,
    filePath,
    cacheDir,
    credentials,
    model,
  });
}
