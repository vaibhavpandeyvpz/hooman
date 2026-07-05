/**
 * Process-wide progress feed for model weight downloads (currently the
 * llama-cpp provider fetching GGUF files from the Hugging Face Hub).
 *
 * The provider emits {@link ModelDownloadProgress} events while a file is
 * actually being downloaded (nothing is emitted for cache hits); frontends
 * subscribe once per process and render however fits their surface (chat TUI
 * chrome row, exec/daemon stderr line, ACP `_hoomanjs/model_download`
 * notification for the VS Code extension).
 */

export type ModelDownloadProgress = {
  status: "downloading" | "done" | "error";
  /** Configured model spec, e.g. `Qwen/Qwen3-1.7B-GGUF:Q8_0`. */
  model: string;
  /** Basename of the file being downloaded, e.g. `Qwen3-1.7B-Q8_0.gguf`. */
  file: string;
  /** Set for sharded GGUFs (each shard is downloaded and reported in turn). */
  shard?: { index: number; total: number };
  receivedBytes: number;
  /** Total file size in bytes; unset when the server did not report one. */
  totalBytes?: number;
  /** Smoothed transfer rate over a recent window; unset until measurable. */
  bytesPerSecond?: number;
  /** Estimated seconds remaining; unset without a total or a rate. */
  etaSeconds?: number;
  /** Failure summary (only on `status: "error"`). */
  error?: string;
};

export type ModelDownloadProgressListener = (
  progress: ModelDownloadProgress,
) => void;

const listeners = new Set<ModelDownloadProgressListener>();

/** Subscribe to model download progress; returns an unsubscribe function. */
export function subscribeModelDownloadProgress(
  listener: ModelDownloadProgressListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Fan an event out to all subscribers (provider-side; listener errors are swallowed). */
export function emitModelDownloadProgress(
  progress: ModelDownloadProgress,
): void {
  for (const listener of [...listeners]) {
    try {
      listener(progress);
    } catch {
      // A broken frontend listener must not fail the download itself.
    }
  }
}

// ---- Formatting helpers (shared by the chat TUI and CLI loggers) -----------

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** "512 B", "1.5 MB", "1.71 GB" — human-readable byte size. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "0 B";
  }
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${BYTE_UNITS[unit]}`;
}

/** "12.3 MB/s" — human-readable transfer rate. */
export function formatBytesPerSecond(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}

/** "45s", "01:23", "1:02:03" — remaining-time estimate. */
export function formatEtaSeconds(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) {
    return `${total}s`;
  }
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mmss = `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${mmss}` : mmss;
}

/** Completion ratio in [0, 1], or `undefined` while the total is unknown. */
export function downloadRatio(
  progress: ModelDownloadProgress,
): number | undefined {
  if (progress.totalBytes === undefined || progress.totalBytes <= 0) {
    return undefined;
  }
  return Math.min(1, progress.receivedBytes / progress.totalBytes);
}

/** "██████░░░░" — a fixed-width unicode progress bar for terminal surfaces. */
export function renderDownloadBar(ratio: number, width = 20): string {
  const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
  return "█".repeat(filled) + "░".repeat(width - filled);
}

/**
 * One-line human summary, e.g.
 * `model.gguf (shard 2/5) 42% • 730 MB / 1.71 GB • 12.3 MB/s • eta 01:23`.
 */
export function formatModelDownloadLine(
  progress: ModelDownloadProgress,
): string {
  const shard = progress.shard
    ? ` (shard ${progress.shard.index}/${progress.shard.total})`
    : "";
  if (progress.status === "error") {
    return `${progress.file}${shard} download failed: ${progress.error ?? "unknown error"}`;
  }
  const parts: string[] = [];
  const ratio = downloadRatio(progress);
  const size =
    progress.totalBytes !== undefined
      ? `${formatBytes(progress.receivedBytes)} / ${formatBytes(progress.totalBytes)}`
      : formatBytes(progress.receivedBytes);
  if (progress.status === "done") {
    parts.push("done", size);
  } else {
    if (ratio !== undefined) {
      parts.push(`${Math.floor(ratio * 100)}%`);
    }
    parts.push(size);
    if (progress.bytesPerSecond !== undefined) {
      parts.push(formatBytesPerSecond(progress.bytesPerSecond));
    }
    if (progress.etaSeconds !== undefined) {
      parts.push(`eta ${formatEtaSeconds(progress.etaSeconds)}`);
    }
  }
  return `${progress.file}${shard} ${parts.join(" • ")}`;
}

/**
 * Progress listener that renders to a terminal stream (exec/daemon stderr).
 * On a TTY it redraws a single status line in place (with a bar); otherwise
 * it logs a plain line at ~10% increments plus start/done/error, so piped
 * logs stay readable.
 */
export function createModelDownloadLogger(options: {
  stream:
    NodeJS.WriteStream | { write(text: string): unknown; isTTY?: boolean };
  /** Prepended to every non-TTY log line (e.g. `[daemon] `). */
  prefix?: string;
}): ModelDownloadProgressListener {
  const { stream } = options;
  const prefix = options.prefix ?? "";
  const tty = stream.isTTY === true;
  let lastLoggedPercent = -1;
  let lineOpen = false;

  return (progress) => {
    if (tty) {
      const ratio = downloadRatio(progress);
      const bar =
        progress.status === "downloading" && ratio !== undefined
          ? `[${renderDownloadBar(ratio)}] `
          : "";
      const line = `${prefix}downloading ${bar}${formatModelDownloadLine(progress)}`;
      stream.write(`\r\x1b[2K${line}`);
      lineOpen = true;
      if (progress.status !== "downloading") {
        stream.write("\n");
        lineOpen = false;
        lastLoggedPercent = -1;
      }
      return;
    }
    if (lineOpen) {
      lineOpen = false;
    }
    if (progress.status !== "downloading") {
      stream.write(
        `${prefix}model download ${formatModelDownloadLine(progress)}\n`,
      );
      lastLoggedPercent = -1;
      return;
    }
    const ratio = downloadRatio(progress);
    const percent = ratio !== undefined ? Math.floor(ratio * 100) : undefined;
    const shouldLog =
      lastLoggedPercent === -1 ||
      (percent !== undefined && percent >= lastLoggedPercent + 10);
    if (!shouldLog) {
      return;
    }
    lastLoggedPercent = percent ?? 0;
    stream.write(
      `${prefix}model download ${formatModelDownloadLine(progress)}\n`,
    );
  };
}
