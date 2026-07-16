import type { FsBackend, TextReadOptions } from "./backend.js";
import { RemoteFsBackend } from "./backends/remote-fs-backend.js";
import type { RemoteTextFsClient } from "./backends/remote-fs-backend.js";
import { getFsBackend, setFsBackend } from "./registry.js";

export type {
  FsBackend,
  RemoteFsBackendCapabilities,
  TextReadOptions,
} from "./backend.js";
export { LocalFsBackend, RemoteFsBackend } from "./backends/index.js";
export type { RemoteTextFsClient } from "./backends/index.js";
export { clearFsBackend, getFsBackend, setFsBackend } from "./registry.js";

export type TextFsReadOptions = TextReadOptions;
export type TextFsBackend = RemoteTextFsClient;
export function setTextFsBackend(
  agent: object,
  backend: RemoteTextFsClient,
): void {
  setFsBackend(agent, new RemoteFsBackend(backend));
}
export function getTextFsBackend(
  agent: object | undefined,
): FsBackend | undefined {
  return agent ? getFsBackend(agent) : undefined;
}
export { applyFileEdit, applyFileEdits } from "./edits/apply.js";
export type { EditResult, FileEdit } from "./edits/types.js";
