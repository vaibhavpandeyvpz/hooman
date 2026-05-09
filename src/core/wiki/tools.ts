import { tool } from "@strands-agents/sdk";
import type { JSONValue } from "@strands-agents/sdk";
import { z } from "zod";
import { Storage } from "./storage.js";

const DEFAULT_SEARCH_LIMIT = 5;
const MAX_SEARCH_LIMIT = 20;

function toJsonValue(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

export async function createWikiTools() {
  const storage = Storage.create();
  await storage.warmup();

  return [
    tool({
      name: "wiki_search",
      description:
        "Search the available knowledge base when you lack specifics about the user's question. Runs semantic search over indexed material; returns snippets plus paths so you can read_file for full context when needed.",
      inputSchema: z.object({
        query: z.string().min(1),
        k: z.number().int().min(1).max(MAX_SEARCH_LIMIT).optional(),
      }),
      callback: async (input) => {
        const k = input.k ?? DEFAULT_SEARCH_LIMIT;
        const matches = await storage.search(input.query, k);
        return toJsonValue({
          query: input.query,
          count: matches.length,
          matches,
        });
      },
    }),
  ];
}
