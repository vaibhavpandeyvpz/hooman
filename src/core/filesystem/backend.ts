export type TextReadOptions = {
  line?: number;
  limit?: number;
};

export type FsBackend = {
  readonly kind: "local" | "remote";
  readTextFile(path: string, options?: TextReadOptions): Promise<string>;
  writeTextFile(path: string, content: string): Promise<void>;
};

export type RemoteFsBackendCapabilities = {
  canRead: boolean;
  canWrite: boolean;
};
