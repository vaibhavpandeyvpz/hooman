import type { ToolCallLocation } from "@agentclientprotocol/sdk";

const KNOWN_TOOL_LOCATION_KEYS = new Map<string, readonly string[]>([
  ["read_file", ["path"]],
  ["read_multiple_files", ["paths"]],
  ["write_file", ["path"]],
  ["edit_file", ["path"]],
  ["create_directory", ["path"]],
  ["list_directory", ["path"]],
  ["directory_tree", ["path"]],
  ["move_file", ["source", "destination"]],
  ["search_files", ["path"]],
  ["get_file_info", ["path"]],
]);

/** ACP `locations` extracted only from known core filesystem tools. */
export function toolCallLocationsFromInput(
  toolName: string,
  input: unknown,
): Array<ToolCallLocation> | undefined {
  const keys = KNOWN_TOOL_LOCATION_KEYS.get(toolName);
  if (!keys) {
    return undefined;
  }
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const o = input as Record<string, unknown>;
  const paths: string[] = [];
  for (const key of keys) {
    const v = o[key];
    if (typeof v === "string" && v.length > 0) {
      paths.push(v);
    } else if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === "string" && item.length > 0) {
          paths.push(item);
        }
      }
    }
  }
  if (paths.length === 0) {
    return undefined;
  }
  return paths.map((path) => ({ path }));
}
