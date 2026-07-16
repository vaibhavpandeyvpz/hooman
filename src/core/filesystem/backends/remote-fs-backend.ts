import type {
  FsBackend,
  RemoteFsBackendCapabilities,
  TextReadOptions,
} from "../backend.js";

export type RemoteTextFsClient = RemoteFsBackendCapabilities & {
  readTextFile(path: string, options?: TextReadOptions): Promise<string>;
  writeTextFile(path: string, content: string): Promise<void>;
};

export class RemoteFsBackend implements FsBackend {
  readonly kind = "remote" as const;

  constructor(private readonly client: RemoteTextFsClient) {}

  async readTextFile(path: string, options?: TextReadOptions): Promise<string> {
    if (!this.client.canRead) {
      throw new Error(
        "The active remote filesystem backend cannot read files.",
      );
    }
    return this.client.readTextFile(path, options);
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    if (!this.client.canWrite) {
      throw new Error(
        "The active remote filesystem backend cannot write files.",
      );
    }
    await this.client.writeTextFile(path, content);
  }
}
