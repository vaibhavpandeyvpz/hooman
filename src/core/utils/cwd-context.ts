import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage<string>();

export function runWithCwd<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  return storage.run(cwd, fn);
}

export function getCwd(): string {
  return storage.getStore() ?? process.cwd();
}
