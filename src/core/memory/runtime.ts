import { AsyncLocalStorage } from "node:async_hooks";
import type { Agent } from "@strands-agents/sdk";

const DEFAULT_MEMORY_SCOPE = "default";
const UNSAFE_SCOPE_CHARS = /[^a-z0-9_-]+/g;

type MemoryScopeState = {
  scope: string;
};

const memoryScopeStorage = new AsyncLocalStorage<MemoryScopeState>();

export function currentMemoryScope(): string {
  return memoryScopeStorage.getStore()?.scope ?? DEFAULT_MEMORY_SCOPE;
}

export async function runWithAgentMemoryScope<T>(
  agent: Agent,
  callback: () => Promise<T>,
): Promise<T> {
  const scope = deriveAgentMemoryScope(agent);
  return await memoryScopeStorage.run({ scope }, callback);
}

export async function flushAgentMemory(agent: Agent): Promise<void> {
  await agent.memoryManager?.flush();
}

function deriveAgentMemoryScope(agent: Agent): string {
  const candidate =
    readString(agent, "userId") ?? readString(agent, "sessionId");
  return sanitizeScope(candidate);
}

function readString(agent: Agent, key: string): string | undefined {
  const value = agent.appState.get(key);
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function sanitizeScope(value?: string): string {
  if (!value) {
    return DEFAULT_MEMORY_SCOPE;
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(UNSAFE_SCOPE_CHARS, "_");
  return normalized.length > 0 ? normalized : DEFAULT_MEMORY_SCOPE;
}
