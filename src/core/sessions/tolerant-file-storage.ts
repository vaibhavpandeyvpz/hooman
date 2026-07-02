import { basename, extname, join } from "node:path";
import { readdir } from "node:fs/promises";
import {
  FileStorage,
  type Storage,
} from "@strands-agents/sdk/vended-plugins/context-offloader";

/** Sidecar file the vended {@link FileStorage} writes; never a real reference. */
const METADATA_FILE = ".metadata.json";

/**
 * Host-filesystem offload storage that tolerates slightly-mangled references.
 *
 * The vended `FileStorage.retrieve` resolves the reference to an exact file
 * path, so a model that copies the reference imperfectly — most commonly by
 * dropping the content-type extension (`…_0.json` -> `…_0`) or the directory
 * prefix — gets an unhelpful "reference not found" even though the artifact is
 * on disk. This wrapper first tries the exact lookup, then falls back to a
 * basename / extension-insensitive match within the artifact directory.
 *
 * It implements {@link Storage} directly (rather than extending `FileStorage`)
 * so the `ContextOffloader` treats it as an opaque backend and uses it as-is
 * (no per-agent sandbox rebinding), keeping retrieval on the host-fs path.
 */
export class TolerantFileStorage implements Storage {
  readonly #artifactDir: string;
  readonly #inner: FileStorage;

  constructor(artifactDir: string) {
    this.#artifactDir = artifactDir;
    this.#inner = new FileStorage(artifactDir);
  }

  store(
    key: string,
    content: Uint8Array,
    contentType?: string,
  ): Promise<string> {
    return this.#inner.store(key, content, contentType);
  }

  async retrieve(
    reference: string,
  ): Promise<{ content: Uint8Array; contentType: string }> {
    try {
      return await this.#inner.retrieve(reference);
    } catch (error) {
      const resolved = await this.#resolveReference(reference);
      if (resolved && resolved !== reference) {
        return this.#inner.retrieve(resolved);
      }
      throw error;
    }
  }

  /**
   * Best-effort match of a mangled reference to an on-disk artifact filename.
   * Returns the resolved filename (relative to the artifact dir) or `null`.
   */
  async #resolveReference(reference: string): Promise<string | null> {
    let entries: string[];
    try {
      entries = await readdir(this.#artifactDir);
    } catch {
      return null;
    }
    const candidates = entries.filter((entry) => entry !== METADATA_FILE);
    const wanted = basename(reference.trim());
    if (!wanted) {
      return null;
    }
    // Exact filename (reference had the right name but a wrong/absent dir).
    if (candidates.includes(wanted)) {
      return join(this.#artifactDir, wanted);
    }
    // Extension dropped: match on the filename stem (e.g. `…_0` -> `…_0.json`).
    const stemMatches = candidates.filter(
      (entry) => stripExt(entry) === wanted,
    );
    if (stemMatches.length === 1) {
      return join(this.#artifactDir, stemMatches[0]!);
    }
    // Reference itself carried an extension the model altered; match by stem.
    const wantedStem = stripExt(wanted);
    const bothStemMatches = candidates.filter(
      (entry) => stripExt(entry) === wantedStem,
    );
    if (bothStemMatches.length === 1) {
      return join(this.#artifactDir, bothStemMatches[0]!);
    }
    return null;
  }
}

function stripExt(filename: string): string {
  const ext = extname(filename);
  return ext ? filename.slice(0, -ext.length) : filename;
}
