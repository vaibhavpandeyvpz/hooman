import type { FsBackend } from "./backend.js";
import { LocalFsBackend } from "./backends/local-fs-backend.js";

const remoteBackends = new WeakMap<object, FsBackend>();
const localBackend = new LocalFsBackend();

export function setFsBackend(agent: object, backend: FsBackend): void {
  remoteBackends.set(agent, backend);
}

export function getFsBackend(agent?: object): FsBackend {
  return agent ? (remoteBackends.get(agent) ?? localBackend) : localBackend;
}

export function clearFsBackend(agent: object): void {
  remoteBackends.delete(agent);
}
