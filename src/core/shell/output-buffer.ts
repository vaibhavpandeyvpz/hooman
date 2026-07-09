import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { basePath } from "../utils/paths.js";

/** In-memory ring capacity before spilling to disk. */
export const RING_CAPACITY_BYTES = 200 * 1024;
/** Kill the job when total output exceeds this size. */
export const WATCHDOG_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Keeps a recent window of output in memory and spills the full stream to
 * disk once the ring fills. Tail reads prefer memory.
 *
 * Spill semantics: when the ring first overflows, the current ring contents
 * are written to the spill file and subsequent chunks are appended to both
 * spill and ring. The ring is then trimmed from the front so it stays under
 * capacity. `readAll()` returns the spill file (authoritative full stream).
 */
export class OutputBuffer {
  #ring = "";
  #ringBytes = 0;
  #spillPath: string | null = null;
  #totalBytes = 0;
  #truncated = false;
  readonly #jobId: string;
  readonly #capacity: number;
  readonly #watchdogMax: number;
  #onWatchdog?: () => void;

  constructor(
    jobId: string,
    opts?: {
      capacity?: number;
      watchdogMax?: number;
      onWatchdog?: () => void;
    },
  ) {
    this.#jobId = jobId;
    this.#capacity = opts?.capacity ?? RING_CAPACITY_BYTES;
    this.#watchdogMax = opts?.watchdogMax ?? WATCHDOG_MAX_BYTES;
    this.#onWatchdog = opts?.onWatchdog;
  }

  get truncated(): boolean {
    return this.#truncated;
  }

  get totalBytes(): number {
    return this.#totalBytes;
  }

  get spillPath(): string | null {
    return this.#spillPath;
  }

  append(chunk: string): void {
    if (!chunk) {
      return;
    }
    const chunkBytes = Buffer.byteLength(chunk, "utf8");
    this.#totalBytes += chunkBytes;

    if (this.#spillPath) {
      try {
        appendFileSync(this.#spillPath, chunk, "utf8");
      } catch {
        this.#truncated = true;
      }
    }

    this.#ring += chunk;
    this.#ringBytes += chunkBytes;

    if (this.#ringBytes > this.#capacity) {
      if (!this.#spillPath) {
        this.#openSpill();
        try {
          writeFileSync(this.#spillPath!, this.#ring, "utf8");
        } catch {
          this.#truncated = true;
        }
      }
      while (this.#ringBytes > this.#capacity && this.#ring.length > 0) {
        const drop = Math.max(1, Math.ceil(this.#ring.length * 0.1));
        const removed = this.#ring.slice(0, drop);
        this.#ring = this.#ring.slice(drop);
        this.#ringBytes -= Buffer.byteLength(removed, "utf8");
        this.#truncated = true;
      }
    }

    if (this.#totalBytes > this.#watchdogMax) {
      this.#onWatchdog?.();
    }
  }

  /** Full accumulated output. */
  readAll(): string {
    if (!this.#spillPath) {
      return this.#ring;
    }
    try {
      return readFileSync(this.#spillPath, "utf8");
    } catch {
      return this.#ring;
    }
  }

  /** Recent window kept in memory (fast path for UI / snapshots). */
  readTail(maxChars = 12_000): string {
    if (this.#ring.length <= maxChars) {
      return this.#ring;
    }
    return this.#ring.slice(-maxChars);
  }

  readTailLines(lines: number): string {
    if (lines <= 0) {
      return "";
    }
    const all = this.readTail(Math.max(lines * 200, 4_000));
    const parts = all.split("\n");
    return parts.slice(-lines).join("\n");
  }

  #openSpill(): void {
    if (this.#spillPath) {
      return;
    }
    const dir = join(basePath(), "shell-jobs");
    mkdirSync(dir, { recursive: true });
    this.#spillPath = join(dir, `${this.#jobId}.log`);
  }
}
