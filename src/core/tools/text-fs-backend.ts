/**
 * Optional per-agent text filesystem backend.
 *
 * When an embedding host (e.g. an ACP client that advertises the `fs`
 * capability) can read/write text files on the agent's behalf, it registers a
 * backend here. The built-in filesystem tools then route text reads and writes
 * through it so the agent sees unsaved editor state and the host can track
 * modifications. When no backend is registered, the tools use local disk I/O.
 */
export type TextFsReadOptions = {
  /** 1-based line to start reading from. */
  line?: number;
  /** Maximum number of lines to read. */
  limit?: number;
};

export type TextFsBackend = {
  /** Whether the host can service text reads (`fs/read_text_file`). */
  canRead: boolean;
  /** Whether the host can service text writes (`fs/write_text_file`). */
  canWrite: boolean;
  readTextFile(path: string, options?: TextFsReadOptions): Promise<string>;
  writeTextFile(path: string, content: string): Promise<void>;
};

/** Keyed by the Strands agent instance so backends are never serialized. */
const backends = new WeakMap<object, TextFsBackend>();

export function setTextFsBackend(agent: object, backend: TextFsBackend): void {
  backends.set(agent, backend);
}

export function getTextFsBackend(
  agent: object | undefined,
): TextFsBackend | undefined {
  return agent ? backends.get(agent) : undefined;
}
