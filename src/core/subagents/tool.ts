import { Agent, tool, type Tool, type ToolContext } from "@strands-agents/sdk";
import type { BaseModelConfig, Model } from "@strands-agents/sdk";
import { z } from "zod";
import {
  type SubagentKindDefinition,
  type SubagentRegistry,
} from "./registry.js";

export const SUBAGENT_TOOL_NAME_PREFIX = "subagent_";

const SubagentInvokeInputSchema = z.object({
  query: z.string().trim().min(1),
});

type CreateSubagentToolsOptions = {
  parent: string;
  registry: SubagentRegistry;
  tools: readonly Tool[];
  createModel: () => Model<BaseModelConfig>;
};

function readAppStateString(context: ToolContext, key: "userId" | "sessionId") {
  const value = context.agent.appState.get(key);
  return typeof value === "string" && value.trim() ? value : undefined;
}

function extractText(response: unknown): string {
  const value = response as {
    lastMessage?: { content?: unknown[] };
    message?: { content?: unknown[] };
  };
  const blocks = value.lastMessage?.content ?? value.message?.content ?? [];
  return blocks
    .map((block) => {
      if (!block || typeof block !== "object") {
        return "";
      }
      const text = (block as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .join("")
    .trim();
}

function subagentToolName(kindId: string): string {
  return `${SUBAGENT_TOOL_NAME_PREFIX}${kindId.replace(/-/g, "_")}`;
}

function selectTools(
  kind: SubagentKindDefinition,
  tools: readonly Tool[],
): readonly Tool[] {
  const byName = new Map<string, Tool>();
  for (const tool of tools) {
    byName.set(tool.name, tool);
  }
  const selected: Tool[] = [];
  for (const name of kind.allowedTools) {
    const candidate = byName.get(name);
    if (!candidate) {
      throw new Error(
        `Subagent '${kind.id}' cannot access missing tool '${name}'.`,
      );
    }
    selected.push(candidate);
  }
  return selected;
}

export function createSubagentTools(
  options: CreateSubagentToolsOptions,
): Tool[] {
  const baseTools = options.tools.filter(
    (entry) => !entry.name.startsWith(SUBAGENT_TOOL_NAME_PREFIX),
  );
  return options.registry.kinds.map((kind) =>
    tool({
      name: subagentToolName(kind.id),
      description: `Delegate a focused ${kind.name} task to a specialized read-only subagent.`,
      inputSchema: SubagentInvokeInputSchema,
      callback: async (input, context?: ToolContext) => {
        if (!context) {
          throw new Error(`Subagent '${kind.id}' requires execution context.`);
        }
        try {
          const child = new Agent({
            name: `${options.parent}-${kind.id}`,
            systemPrompt: kind.instructions,
            model: options.createModel(),
            appState: {
              ...(readAppStateString(context, "userId")
                ? { userId: readAppStateString(context, "userId") }
                : {}),
              ...(readAppStateString(context, "sessionId")
                ? { sessionId: readAppStateString(context, "sessionId") }
                : {}),
              "hooman.subagentKind": kind.id,
            },
            tools: [...selectTools(kind, baseTools)],
            printer: false,
          });
          const response = context.agent.cancelSignal
            ? await child.invoke(input.query, {
                cancelSignal: context.agent.cancelSignal,
              })
            : await child.invoke(input.query);
          return extractText(response);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          return `Subagent '${kind.id}' failed: ${detail}`;
        }
      },
    }),
  );
}
