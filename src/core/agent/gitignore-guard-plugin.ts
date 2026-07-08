import {
  BeforeToolCallEvent,
  HookOrder,
  type Plugin,
} from "@strands-agents/sdk";
import { assertPathNotGitignored } from "../utils/gitignore.js";
import { normalizeUserPath } from "../utils/normalize-user-path.js";

type ToolInput = Record<string, unknown>;

type PathProbe = {
  path: string;
  isDirectory?: boolean;
};

const GUARDED_TOOLS = new Set([
  "read_file",
  "read_multiple_files",
  "write_file",
  "edit_file",
  "create_directory",
  "list_directory",
  "directory_tree",
  "move_file",
  "get_file_info",
]);

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function extractPathProbes(toolName: string, input: ToolInput): PathProbe[] {
  switch (toolName) {
    case "read_file":
    case "write_file":
    case "edit_file":
    case "get_file_info":
      return typeof input.path === "string" ? [{ path: input.path }] : [];
    case "read_multiple_files":
      return isStringArray(input.paths)
        ? input.paths.map((item) => ({ path: item }))
        : [];
    case "create_directory":
    case "list_directory":
    case "directory_tree":
      return typeof input.path === "string"
        ? [{ path: input.path, isDirectory: true }]
        : [];
    case "move_file": {
      const probes: PathProbe[] = [];
      if (typeof input.source === "string") {
        probes.push({ path: input.source });
      }
      if (typeof input.destination === "string") {
        probes.push({ path: input.destination });
      }
      return probes;
    }
    default:
      return [];
  }
}

export function createGitignoreGuardPlugin(): Plugin {
  return {
    name: "hooman:gitignore-guard",
    initAgent(agent): void {
      agent.addHook(
        BeforeToolCallEvent,
        async (event) => {
          const toolName = event.toolUse.name;
          if (!GUARDED_TOOLS.has(toolName)) {
            return;
          }

          const input = event.toolUse.input;
          if (!input || typeof input !== "object" || Array.isArray(input)) {
            return;
          }

          const probes = extractPathProbes(toolName, input as ToolInput);
          for (const probe of probes) {
            try {
              await assertPathNotGitignored(normalizeUserPath(probe.path), {
                isDirectory: probe.isDirectory,
              });
            } catch (error) {
              event.cancel =
                error instanceof Error ? error.message : String(error);
              return;
            }
          }
        },
        { order: HookOrder.SDK_FIRST - 1 },
      );
    },
  };
}
