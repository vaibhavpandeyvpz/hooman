type AppStateLike = {
  get<T = unknown>(key: string): T;
  set(key: string, value: unknown): void;
};

type AgentLike = {
  appState: AppStateLike;
};

const SESSION_ALLOWED_TOOLS_KEY = "allowedTools";

export const INTERNAL_ALWAYS_ALLOWED = new Set([
  // Strands / runtime
  "strands_structured_output",
  // Todos
  "update_todos",
  // Thinking
  "think",
  // Agent orchestration
  "run_agents",
  // Sleep
  "sleep",
  // Process lifecycle
  "bye",
  // Time
  "convert_time",
  "get_current_time",
  // Wiki
  "wiki_knowledge_graph",
  "wiki_list_files",
  "wiki_read_file",
  "wiki_search",
  "wiki_stats",
  "wiki_write_file",
  // Web search
  "web_search",
  // Long-term memory
  "archive_memory",
  "search_memory",
  "store_memory",
  "update_memory",
  // Filesystem (list / search / metadata)
  "directory_tree",
  "get_file_info",
  "list_directory",
  "search_files",
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
