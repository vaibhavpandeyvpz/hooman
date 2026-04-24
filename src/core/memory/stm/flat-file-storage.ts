import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  Snapshot,
  SnapshotLocation,
  SnapshotManifest,
  SnapshotStorage,
} from "@strands-agents/sdk";

/**
 * Snapshot storage with a flat per-session layout:
 * `<baseDir>/<sessionId>/snapshot_latest.json`.
 */
export class FlatFileStorage implements SnapshotStorage {
  constructor(private readonly baseDir: string) {}

  async saveSnapshot(params: {
    location: SnapshotLocation;
    snapshotId: string;
    isLatest: boolean;
    snapshot: Snapshot;
  }): Promise<void> {
    const path = this.snapshotPath(params.location, params.snapshotId);
    await mkdir(join(this.sessionDir(params.location.sessionId)), {
      recursive: true,
    });
    await writeFile(path, JSON.stringify(params.snapshot, null, 2), "utf8");
  }

  async loadSnapshot(params: {
    location: SnapshotLocation;
    snapshotId?: string;
  }): Promise<Snapshot | null> {
    const path = this.snapshotPath(params.location, params.snapshotId);
    try {
      const raw = await readFile(path, "utf8");
      return JSON.parse(raw) as Snapshot;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    }
  }

  async listSnapshotIds(): Promise<string[]> {
    // Flat storage only tracks one mutable snapshot.
    return [];
  }

  async deleteSession(params: { sessionId: string }): Promise<void> {
    await rm(this.sessionDir(params.sessionId), {
      recursive: true,
      force: true,
    });
  }

  async loadManifest(): Promise<SnapshotManifest> {
    return {
      schemaVersion: "1.0",
      updatedAt: new Date().toISOString(),
    };
  }

  async saveManifest(): Promise<void> {
    // No-op: flat storage doesn't persist manifest metadata.
  }

  private sessionDir(sessionId: string): string {
    return join(this.baseDir, sessionId);
  }

  private snapshotPath(
    location: SnapshotLocation,
    snapshotId?: string,
  ): string {
    if (snapshotId && snapshotId !== "latest") {
      return join(
        this.sessionDir(location.sessionId),
        `snapshot_${snapshotId}.json`,
      );
    }
    return join(this.sessionDir(location.sessionId), "snapshot_latest.json");
  }
}
