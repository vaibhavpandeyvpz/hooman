import { existsSync } from "fs";
import { homedir } from "os";
import { basename, isAbsolute, join, sep } from "path";
import { downloadFileToCacheDir, listFiles } from "@huggingface/hub";
import { cachePath } from "../../utils/paths.js";
import { emitModelDownloadProgress } from "../download-progress.js";
import type { ModelDownloadProgress } from "../download-progress.js";

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
 * - `owner/repo:Q8_0` (pick the variant matching a quant tag, llama.cpp style)
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
 * With a `quant` tag (e.g. `Q8_0` from `owner/repo:Q8_0`) only files whose
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

/** Minimum time between "downloading" progress emissions. */
const PROGRESS_EMIT_INTERVAL_MS = 250;
/** Window over which the transfer rate (and thus the ETA) is smoothed. */
const SPEED_WINDOW_MS = 5_000;
/** Responses smaller than this are treated as API chatter, not the file. */
const MIN_DOWNLOAD_BODY_BYTES = 1024 * 1024;

type ProgressReporter = {
  fetch: typeof fetch;
  /** Emit a final `done` event (only if a download actually happened). */
  done(): void;
  /** Emit an `error` event (only if a download actually happened). */
  error(message: string): void;
};

/**
 * Byte-counting `fetch` for {@link downloadFileToCacheDir} that reports
 * download progress (percent, bytes, speed, ETA) for the file's blob GET.
 * API calls made through the same fetch (`pathsInfo`, the `Range: bytes=0-0`
 * download-info probe) are passed through untouched; cache hits never fetch
 * the blob at all, so no events fire for already-downloaded models.
 */
function createProgressReporter(
  base: Omit<
    ModelDownloadProgress,
    "status" | "receivedBytes" | "totalBytes" | "bytesPerSecond" | "etaSeconds"
  >,
): ProgressReporter {
  let started = false;
  let received = 0;
  let total: number | undefined;
  let lastEmitAt = 0;
  let samples: Array<{ at: number; received: number }> = [];

  const snapshot = (
    status: ModelDownloadProgress["status"],
  ): ModelDownloadProgress => {
    const now = Date.now();
    samples.push({ at: now, received });
    samples = samples.filter((s) => now - s.at <= SPEED_WINDOW_MS);
    const first = samples[0]!;
    const elapsedMs = now - first.at;
    const bytesPerSecond =
      elapsedMs > 0
        ? ((received - first.received) / elapsedMs) * 1000
        : undefined;
    const etaSeconds =
      status === "downloading" &&
      total !== undefined &&
      bytesPerSecond !== undefined &&
      bytesPerSecond > 0
        ? (total - received) / bytesPerSecond
        : undefined;
    return {
      ...base,
      status,
      receivedBytes: received,
      ...(total !== undefined ? { totalBytes: total } : {}),
      ...(bytesPerSecond !== undefined && bytesPerSecond >= 0
        ? { bytesPerSecond }
        : {}),
      ...(etaSeconds !== undefined ? { etaSeconds } : {}),
    };
  };

  const countingFetch: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    const requestHeaders = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    const contentLength = Number(response.headers.get("content-length"));
    const isBlobDownload =
      method === "GET" &&
      !requestHeaders.has("Range") &&
      response.status === 200 &&
      response.body !== null &&
      (!Number.isFinite(contentLength) ||
        contentLength >= MIN_DOWNLOAD_BODY_BYTES);
    if (!isBlobDownload) {
      return response;
    }
    started = true;
    received = 0;
    samples = [];
    total =
      Number.isFinite(contentLength) && contentLength > 0
        ? contentLength
        : undefined;
    emitModelDownloadProgress(snapshot("downloading"));
    lastEmitAt = Date.now();
    const counted = response.body!.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform: (chunk, controller) => {
          received += chunk.byteLength;
          const now = Date.now();
          if (now - lastEmitAt >= PROGRESS_EMIT_INTERVAL_MS) {
            lastEmitAt = now;
            emitModelDownloadProgress(snapshot("downloading"));
          }
          controller.enqueue(chunk);
        },
      }),
    );
    return new Response(counted, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };

  return {
    fetch: countingFetch,
    done: () => {
      if (started) {
        emitModelDownloadProgress(snapshot("done"));
      }
    },
    error: (message: string) => {
      if (started) {
        emitModelDownloadProgress({ ...snapshot("error"), error: message });
      }
    },
  };
}

/** Download one file with progress reporting (cache hits stay silent). */
async function downloadFileWithProgress(options: {
  repo: string;
  filePath: string;
  cacheDir: string;
  credentials: { accessToken?: string };
  model: string;
  shard?: { index: number; total: number };
}): Promise<string> {
  const reporter = createProgressReporter({
    model: options.model,
    file: basename(options.filePath),
    ...(options.shard ? { shard: options.shard } : {}),
  });
  try {
    // `xet: false` forces the plain-HTTP single-stream download path instead
    // of xet chunk reconstruction, so the counting fetch sees one measurable
    // response. `downloadFileToCacheDir` forwards extra params to
    // `downloadFile`, which honors it; the option just isn't in its public
    // type, hence the cast.
    const params = {
      repo: options.repo,
      path: options.filePath,
      cacheDir: options.cacheDir,
      fetch: reporter.fetch,
      ...options.credentials,
      xet: false,
    };
    const local = await downloadFileToCacheDir(
      params as Parameters<typeof downloadFileToCacheDir>[0],
    );
    reporter.done();
    return local;
  } catch (e) {
    reporter.error(e instanceof Error ? e.message : String(e));
    throw e;
  }
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
