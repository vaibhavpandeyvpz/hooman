import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { mcpOauthJsonPath } from "../../utils/paths.js";
import {
  StoredMcpOAuthFileSchema,
  type StoredMcpOAuthEntry,
  type StoredMcpOAuthFile,
} from "./types.js";

export class Store {
  public constructor(private readonly path: string = mcpOauthJsonPath()) {}

  public get filePath(): string {
    return this.path;
  }

  public async read(): Promise<StoredMcpOAuthFile> {
    try {
      const raw = await readFile(this.path, "utf8");
      return StoredMcpOAuthFileSchema.parse(JSON.parse(raw));
    } catch (error) {
      if (isMissingFile(error)) {
        return { entries: {} };
      }
      throw error;
    }
  }

  public async list(): Promise<Record<string, StoredMcpOAuthEntry>> {
    const data = await this.read();
    return { ...data.entries };
  }

  public async get(key: string): Promise<StoredMcpOAuthEntry | undefined> {
    const data = await this.read();
    return data.entries[key];
  }

  public async set(key: string, entry: StoredMcpOAuthEntry): Promise<void> {
    const data = await this.read();
    data.entries[key] = entry;
    await this.write(data);
  }

  public async update(
    key: string,
    updater: (
      current: StoredMcpOAuthEntry | undefined,
    ) => StoredMcpOAuthEntry | undefined,
  ): Promise<void> {
    const data = await this.read();
    const next = updater(data.entries[key]);
    if (next) {
      data.entries[key] = next;
    } else {
      delete data.entries[key];
    }
    await this.write(data);
  }

  public async delete(key: string): Promise<void> {
    const data = await this.read();
    if (!data.entries[key]) {
      return;
    }
    delete data.entries[key];
    await this.write(data);
  }

  public async clear(): Promise<void> {
    try {
      await unlink(this.path);
    } catch (error) {
      if (!isMissingFile(error)) {
        throw error;
      }
    }
  }

  private async write(data: StoredMcpOAuthFile): Promise<void> {
    const parsed = StoredMcpOAuthFileSchema.parse(data);
    if (Object.keys(parsed.entries).length === 0) {
      await this.clear();
      return;
    }
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(parsed, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
