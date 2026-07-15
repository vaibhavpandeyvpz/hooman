import type { Usage } from "@strands-agents/sdk";
import type { ResolvedLlmMetadata } from "../utils/metadata.js";

export type SubagentUsageReport = {
  kind: string;
  modelName?: string;
  usage: Usage;
  metadata: ResolvedLlmMetadata | null;
};

type SubagentUsageListener = (
  report: SubagentUsageReport,
) => void | Promise<void>;

const listenersByParent = new WeakMap<object, Set<SubagentUsageListener>>();

export function subscribeSubagentUsage(
  parent: object,
  listener: SubagentUsageListener,
): () => void {
  let listeners = listenersByParent.get(parent);
  if (!listeners) {
    listeners = new Set();
    listenersByParent.set(parent, listeners);
  }
  listeners.add(listener);
  return () => {
    listeners?.delete(listener);
    if (listeners?.size === 0) {
      listenersByParent.delete(parent);
    }
  };
}

export async function emitSubagentUsage(
  parent: object,
  report: SubagentUsageReport,
): Promise<void> {
  const listeners = listenersByParent.get(parent);
  if (!listeners) {
    return;
  }
  await Promise.all([...listeners].map((listener) => listener(report)));
}
