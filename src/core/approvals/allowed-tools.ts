type AppStateLike = {
  get<T = unknown>(key: string): T;
  set(key: string, value: unknown): void;
};

type AgentLike = {
  appState: AppStateLike;
};

const SESSION_ALLOWED_TOOLS_KEY = "allowedTools";

export const INTERNAL_ALWAYS_ALLOWED = new Set([
  "strands_structured_output",
  "update_todos",
  "think",
  "get_current_time",
  "convert_time",
  "wiki_list_files",
  "wiki_read_file",
  "wiki_write_file",
  "wiki_knowledge_graph",
  "wiki_stats",
  "wiki_search",
]);

function normalizeAllowedTools(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const normalized = entry.trim();
    if (!normalized) {
      continue;
    }
    unique.add(normalized);
  }
  return [...unique];
}

export function getSessionAllowedTools(agent: AgentLike): string[] {
  const current = normalizeAllowedTools(
    agent.appState.get(SESSION_ALLOWED_TOOLS_KEY),
  );
  const raw = agent.appState.get(SESSION_ALLOWED_TOOLS_KEY);
  if (!Array.isArray(raw) || current.length !== raw.length) {
    agent.appState.set(SESSION_ALLOWED_TOOLS_KEY, current);
  }
  return current;
}

export function isToolSessionAllowed(
  agent: AgentLike,
  toolName: string,
): boolean {
  return getSessionAllowedTools(agent).includes(toolName);
}

export function allowToolForSession(agent: AgentLike, toolName: string): void {
  const normalized = toolName.trim();
  if (!normalized) {
    return;
  }
  const allowed = getSessionAllowedTools(agent);
  if (allowed.includes(normalized)) {
    return;
  }
  agent.appState.set(SESSION_ALLOWED_TOOLS_KEY, [...allowed, normalized]);
}
