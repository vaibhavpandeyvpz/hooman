import { basename } from "path";
import { downloadFileToCacheDir } from "@huggingface/hub";
import { emitModelDownloadProgress } from "./download-progress.js";
import type { ModelDownloadProgress } from "./download-progress.js";

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

/**
 * Download one file from a Hugging Face repo into the HF-layout cache dir
 * with progress reporting (cache hits stay silent) and return its local path.
 * `xet: false` forces the plain-HTTP single-stream download path instead of
 * xet chunk reconstruction, so the counting fetch sees one measurable
 * response. `downloadFileToCacheDir` forwards extra params to `downloadFile`,
 * which honors it; the option just isn't in its public type, hence the cast.
 */
export async function downloadFileWithProgress(options: {
  repo: string;
  filePath: string;
  cacheDir: string;
  credentials: { accessToken?: string };
  model: string;
  shard?: { index: number; total: number };
  /**
   * Git revision (pass a full commit sha when downloading several files of
   * one repo: the cache names snapshot dirs after each file's last commit,
   * so un-pinned multi-file downloads scatter across snapshot dirs).
   */
  revision?: string;
}): Promise<string> {
  const reporter = createProgressReporter({
    model: options.model,
    file: basename(options.filePath),
    ...(options.shard ? { shard: options.shard } : {}),
  });
  try {
    const params = {
      repo: options.repo,
      path: options.filePath,
      cacheDir: options.cacheDir,
      fetch: reporter.fetch,
      ...(options.revision ? { revision: options.revision } : {}),
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
