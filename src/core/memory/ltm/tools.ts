import { tool } from "@strands-agents/sdk";
import type { JSONValue, ToolContext } from "@strands-agents/sdk";
import { z } from "zod";
import type { LongTermMemoryStore } from "./store.js";
import type { LongTermMemoryScope, MemoryType } from "./types.js";

const StoreTypes: [MemoryType, ...MemoryType[]] = [
  "fact",
  "preference",
  "task",
];
const SearchTypes: [MemoryType, ...MemoryType[]] = [
  "fact",
  "preference",
  "task",
  "episodic",
  "semantic",
];

function toJsonValue(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

function resolveScope(context?: ToolContext): LongTermMemoryScope {
  const userId = context?.agent.appState.get("userId");
  if (typeof userId !== "string" || userId.trim().length === 0) {
    throw new Error(
      "Long-term memory tools require `userId` in agent appState.",
    );
  }

  return { userId };
}

export function create(ltm: LongTermMemoryStore) {
  return [
    tool({
      name: "memory_store",
      description:
        "Store important long-term memory. Only use for reusable facts, preferences, or tasks.",
      inputSchema: z.object({
        content: z.string().min(1).describe("Compressed memory content"),
        type: z.enum(StoreTypes),
        importance: z.number().min(0).max(1).optional(),
        tags: z.array(z.string()).optional(),
        entities: z.array(z.string()).optional(),
      }),
      callback: async (input, context?: ToolContext) => {
        const scope = resolveScope(context);
        const result = await ltm.store(
          {
            content: input.content,
            type: input.type,
            importance: input.importance,
            tags: input.tags,
            entities: input.entities,
            dedupe: true,
          },
          scope,
        );

        return toJsonValue({
          id: result.id,
          merged: result.merged,
          memory: result.memory,
        });
      },
    }),
    tool({
      name: "memory_search",
      description:
        "Search relevant past memory for context. Use only if additional context is needed.",
      inputSchema: z.object({
        query: z.string().min(1).describe("What to search for"),
        types: z.array(z.enum(SearchTypes)).optional(),
        k: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe("Number of results (default 5, max 20)"),
      }),
      callback: async (input, context?: ToolContext) => {
        const scope = resolveScope(context);
        const memories = await ltm.search({
          query: input.query,
          scope,
          types: input.types,
          limit: input.k,
          reinforce: true,
        });

        return toJsonValue({
          count: memories.length,
          memories,
        });
      },
    }),
    tool({
      name: "memory_update",
      description:
        "Update or correct an existing memory. Prefer this over deleting.",
      inputSchema: z.object({
        id: z.string().min(1),
        content: z.string().min(1),
        tags: z.array(z.string()).optional(),
        entities: z.array(z.string()).optional(),
      }),
      callback: async (input) => {
        const memory = await ltm.update({
          id: input.id,
          content: input.content,
          tags: input.tags,
          entities: input.entities,
        });

        return toJsonValue({
          id: memory.id,
          memory,
        });
      },
    }),
    tool({
      name: "memory_archive",
      description: "Mark memory as no longer relevant without deleting it.",
      inputSchema: z.object({
        id: z.string().min(1),
        reason: z.string().optional(),
      }),
      callback: async (input) => {
        const memory = await ltm.archive({
          id: input.id,
          status: "archived",
        });

        return toJsonValue({
          id: memory.id,
          status: memory.status,
          reason: input.reason ?? null,
          memory,
        });
      },
    }),
  ];
}
