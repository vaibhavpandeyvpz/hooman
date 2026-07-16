import fs from "node:fs/promises";
import type { FsBackend, TextReadOptions } from "../backend.js";

export class LocalFsBackend implements FsBackend {
  readonly kind = "local" as const;

  async readTextFile(path: string, options?: TextReadOptions): Promise<string> {
    const content = await fs.readFile(path, "utf8");
    if (!options?.line && !options?.limit) {
      return content;
    }
    const start = Math.max(0, (options.line ?? 1) - 1);
    const end = options.limit === undefined ? undefined : start + options.limit;
    return content.split(/\r?\n/).slice(start, end).join("\n");
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    await fs.writeFile(path, content, "utf8");
  }
}
