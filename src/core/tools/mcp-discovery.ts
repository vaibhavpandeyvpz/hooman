import { tool } from "@strands-agents/sdk";
import type { JSONValue, ToolContext } from "@strands-agents/sdk";
import { z } from "zod";
import {
  LazyToolRegistry,
  type ToolCatalogEntry,
} from "../agent/lazy-tool-registry.js";
import {
  activateMcpTool,
  getActiveMcpToolNames,
} from "../state/active-mcp-tools.js";

const SEARCH_TOOLS_SCHEMA = z.object({
  query: z.string().trim().min(1),
  limit: z.number().int().min(1).max(10).optional(),
});

const ACTIVATE_TOOLS_SCHEMA = z.object({
  names: z.array(z.string().trim().min(1)).min(1).max(10),
});

const READ_INTENT_TERMS = new Set([
  "search",
  "find",
  "list",
  "get",
  "read",
  "show",
  "inspect",
  "query",
]);

const QUERY_SYNONYMS: Record<string, string[]> = {
  pr: ["pull", "request"],
  prs: ["pull", "request"],
  repo: ["repository"],
  repos: ["repository"],
  msg: ["message"],
  msgs: ["message"],
  ticket: ["issue"],
  tickets: ["issue"],
};

function toJsonValue(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_\-\s]+/g, " ")
    .split(/[\s_\-]+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function expandQueryTokens(query: string): string[] {
  const base = tokenize(query);
  const expanded = new Set(base);
  for (const token of base) {
    for (const synonym of QUERY_SYNONYMS[token] ?? []) {
      expanded.add(synonym);
    }
  }
  return [...expanded];
}

function overlapScore(
  queryTokens: readonly string[],
  fieldTokens: readonly string[],
): number {
  if (queryTokens.length === 0 || fieldTokens.length === 0) {
    return 0;
  }
  const field = new Set(fieldTokens);
  let score = 0;
  for (const token of queryTokens) {
    if (field.has(token)) {
      score += 1;
    }
  }
  return score;
}

function hasReadIntent(tokens: readonly string[]): boolean {
  return tokens.some((token) => READ_INTENT_TERMS.has(token));
}

function scoreEntry(
  query: string,
  queryTokens: readonly string[],
  entry: ToolCatalogEntry,
  active: boolean,
): { score: number; why: string[] } {
  const why: string[] = [];
  const nameTokens = tokenize(entry.name);
  const descriptionTokens = tokenize(entry.description);
  const serverTokens = tokenize(entry.server);
  const argTokens = entry.args.flatMap((arg) => tokenize(arg));

  let score = 0;
  const loweredQuery = query.trim().toLowerCase();
  const loweredName = entry.name.toLowerCase();
  const loweredServer = entry.server.toLowerCase();

  if (loweredName.includes(loweredQuery)) {
    score += 10;
    why.push("name match");
  }
  const nameOverlap = overlapScore(queryTokens, nameTokens);
  if (nameOverlap > 0) {
    score += nameOverlap * 7;
    why.push("name tokens overlap");
  }
  const descriptionOverlap = overlapScore(queryTokens, descriptionTokens);
  if (descriptionOverlap > 0) {
    score += descriptionOverlap * 6;
    why.push("description overlap");
  }
  if (loweredServer.includes(loweredQuery)) {
    score += 4;
    why.push("server match");
  }
  const serverOverlap = overlapScore(queryTokens, serverTokens);
  if (serverOverlap > 0) {
    score += serverOverlap * 4;
    if (!why.includes("server match")) {
      why.push("server overlap");
    }
  }
  const argOverlap = overlapScore(queryTokens, argTokens);
  if (argOverlap > 0) {
    score += argOverlap * 3;
    why.push("argument match");
  }
  if (entry.readOnly && hasReadIntent(queryTokens)) {
    score += 2;
    why.push("read-only fit");
  }
  if (active) {
    score += 2;
    why.push("already active");
  }

  return { score, why: why.slice(0, 3) };
}

export function createMcpDiscoveryTools(registry: LazyToolRegistry) {
  return [
    tool({
      name: "search_tools",
      description:
        "Search connected MCP tools using a short natural-language query. Use this only for MCP-discovered tools; built-in tools are already available by default.",
      inputSchema: SEARCH_TOOLS_SCHEMA,
      callback: async (input, context?: ToolContext) => {
        const agent = context?.agent;
        const catalog = registry.hidden();
        if (!agent || catalog.length === 0) {
          return toJsonValue({
            query: input.query,
            results: [],
            message: "No MCP tools are available to search in this session.",
          });
        }

        const queryTokens = expandQueryTokens(input.query);
        const activeNames = new Set(getActiveMcpToolNames(agent));
        const limit = input.limit ?? 5;
        const results = catalog
          .map((entry) => {
            const active = activeNames.has(entry.name);
            const scored = scoreEntry(input.query, queryTokens, entry, active);
            return {
              ...entry,
              active,
              activatable: true,
              score: scored.score,
              why: scored.why,
            };
          })
          .filter((entry) => entry.score > 0)
          .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
          .slice(0, limit);

        return toJsonValue({
          query: input.query,
          results,
        });
      },
    }),
    tool({
      name: "activate_tools",
      description:
        "Activate one or more connected MCP tools so they become available on the next model cycle in this session. Use this only for MCP-discovered tools; built-in tools are already available by default.",
      inputSchema: ACTIVATE_TOOLS_SCHEMA,
      callback: async (input, context?: ToolContext) => {
        if (!context) {
          throw new Error("activate_tools requires execution context.");
        }
        const activated: string[] = [];
        const alreadyActive: string[] = [];
        const skipped: Array<{ name: string; reason: string }> = [];
        const active = new Set(getActiveMcpToolNames(context.agent));
        for (const rawName of input.names) {
          const name = rawName.trim();
          if (!name) {
            continue;
          }
          if (active.has(name) || registry.isToolRegistered(name)) {
            alreadyActive.push(name);
            continue;
          }
          const entry = registry.hiddenEntry(name);
          if (!entry) {
            skipped.push({ name, reason: "Unknown MCP tool." });
            continue;
          }
          activateMcpTool(context.agent, name);
          activated.push(name);
        }
        return toJsonValue({
          activated,
          already_active: alreadyActive,
          skipped,
        });
      },
    }),
  ];
}
