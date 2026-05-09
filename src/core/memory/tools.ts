import { tool } from "@strands-agents/sdk";
import type { JSONValue, ToolContext } from "@strands-agents/sdk";
import { z } from "zod";
import type { MemoryType } from "./types.js";
import { Brain } from "./brain.js";
import { memoryDbPath, modelsCachePath } from "../utils/paths.js";
import { DEFAULT_EMBED_MODEL } from "../config.js";
import { GgufEmbedder } from "../inference/index.js";
import { md5 } from "../utils/hashing.js";

const MemoryScopes: ["user", "project"] = ["user", "project"];

const MemoryTypes: [MemoryType, ...MemoryType[]] = [
  "fact",
  "observation",
  "preference",
  "task",
];

function toJsonValue(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

function toMemoryScope(
  context?: ToolContext,
  project: boolean = false,
): string {
  if (!context) {
    return "default";
  }
  const userId = context.agent.appState.get("userId");
  if (!userId || typeof userId !== "string") {
    return "default";
  }
  return project
    ? md5(userId.trim() + "_" + process.cwd())
    : md5(userId.trim());
}

export async function create() {
  const embedder = new GgufEmbedder({
    modelUri: DEFAULT_EMBED_MODEL,
    cacheDir: modelsCachePath(),
  });
  const brain = new Brain(memoryDbPath(), embedder);
  await brain.warmup();

  return [
    tool({
      name: "memory_add",
      description:
        "Remember long-term memory. Use `user` for cross-session personal context, `project` for this working-directory only. Prefer facts, observations, preferences, or tasks. Optional `metadata` is stored and indexed for retrieval; use string values when possible.",
      inputSchema: z.object({
        scope: z
          .enum(MemoryScopes)
          .describe(
            "`user`: per-user across projects; `project`: this working directory only.",
          ),
        content: z.string().min(1).describe("Memory content"),
        type: z.enum(MemoryTypes),
        metadata: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            "Optional JSON-serializable fields (e.g. title, source, tags). `title` can tune embedding.",
          ),
      }),
      callback: async (input, context?: ToolContext) => {
        const scope = toMemoryScope(context, input.scope === "project");
        const id = await brain.memorize(
          scope,
          input.content,
          input.type,
          input.metadata ?? {},
        );

        return toJsonValue({ id });
      },
    }),
    tool({
      name: "memory_search",
      description:
        "Search memories in the given scope (`user` or `project`). Use only if additional context is needed. Optionally filter by `types`.",
      inputSchema: z.object({
        scope: z
          .enum(MemoryScopes)
          .describe(
            "`user`: per-user across projects; `project`: this working directory only.",
          ),
        query: z.string().min(1).describe("What to search for"),
        types: z
          .array(z.enum(MemoryTypes))
          .optional()
          .describe("If set, only memories of these kinds are returned"),
        k: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe("Number of results (default 5, max 20)"),
      }),
      callback: async (input, context?: ToolContext) => {
        const scope = toMemoryScope(context, input.scope === "project");
        const memories = await brain.search(
          scope,
          input.query,
          input.types,
          input.k ?? 5,
        );

        return toJsonValue({
          count: memories.length,
          memories,
        });
      },
    }),
    tool({
      name: "memory_archive",
      description:
        "Mark a memory in the given scope as no longer relevant (soft archive).",
      inputSchema: z.object({
        scope: z
          .enum(MemoryScopes)
          .describe(
            "Must match the scope where the memory was stored (`user` or `project`).",
          ),
        id: z.string().min(1),
        reason: z.string().optional(),
      }),
      callback: async (input, context?: ToolContext) => {
        const scope = toMemoryScope(context, input.scope === "project");
        const archived = brain.archive(scope, input.id);
        return toJsonValue({ archived });
      },
    }),
  ];
}
