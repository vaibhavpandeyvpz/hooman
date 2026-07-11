import { Agent, tool, type Tool, type ToolContext } from "@strands-agents/sdk";
import type { BaseModelConfig, Model } from "@strands-agents/sdk";
import { z } from "zod";
import type { ResolvedLlmInputModality } from "../utils/model-metadata.js";
import {
  getLlmModality,
  LLM_MODALITY_STATE_KEY,
  setLlmModality,
} from "../state/llm-modality.js";
import {
  type SubagentKindDefinition,
  type SubagentRegistry,
} from "./registry.js";

export const LAUNCH_SUBAGENT_TOOL_NAME = "launch_subagent";

const LaunchSubagentBaseSchema = z.object({
  query: z.string().trim().min(1),
});

type CreateSubagentToolsOptions = {
  parent: string;
  registry: SubagentRegistry;
  tools: readonly Tool[];
  /** Configured LLM names (`config.llms[].name`) offered as the optional `model` arg. */
  modelNames: readonly string[];
  /** Create a model; omit `name` to use the session's current model. */
  createModel: (name?: string) => Model<BaseModelConfig>;
  /** Resolve input modality for a named (or current) model. */
  resolveModality: (
    name?: string,
  ) => Promise<ResolvedLlmInputModality | null | undefined>;
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

function asNonEmptyEnum(values: readonly string[]): [string, ...string[]] {
  if (values.length === 0) {
    throw new Error("Expected at least one value for enum schema.");
  }
  return values as [string, ...string[]];
}

function buildInputSchema(
  kindIds: readonly string[],
  modelNames: readonly string[],
) {
  const kind = z
    .enum(asNonEmptyEnum(kindIds))
    .describe("Subagent specialist to launch.");
  if (modelNames.length === 0) {
    return LaunchSubagentBaseSchema.extend({ kind });
  }
  return LaunchSubagentBaseSchema.extend({
    kind,
    model: z
      .enum(asNonEmptyEnum(modelNames))
      .optional()
      .describe(
        "Optional configured model name. When omitted, uses the current session model.",
      ),
  });
}

function kindCatalog(registry: SubagentRegistry): string {
  return registry.kinds
    .map((kind) => `- ${kind.id}: ${kind.description}`)
    .join("\n");
}

export function createSubagentTools(
  options: CreateSubagentToolsOptions,
): Tool[] {
  const kindIds = options.registry.kinds.map((kind) => kind.id);
  if (kindIds.length === 0) {
    return [];
  }
  const baseTools = options.tools.filter(
    (entry) => entry.name !== LAUNCH_SUBAGENT_TOOL_NAME,
  );
  const inputSchema = buildInputSchema(kindIds, options.modelNames);
  const description = [
    "Delegate a focused task to a specialized read-only subagent.",
    "Pass `kind` to select the specialist; optionally pass `model` (a configured LLM name) to override the current session model.",
    "For design-review: pass every reviews/*.png path in the query and require binary reads — do not skip after export_design format:images.",
    "Kinds:",
    kindCatalog(options.registry),
  ].join("\n");

  return [
    tool({
      name: LAUNCH_SUBAGENT_TOOL_NAME,
      description,
      inputSchema,
      callback: async (
        input: { kind: string; query: string; model?: string },
        context?: ToolContext,
      ) => {
        if (!context) {
          throw new Error(
            `${LAUNCH_SUBAGENT_TOOL_NAME} requires execution context.`,
          );
        }
        const kind = options.registry.byId.get(input.kind);
        if (!kind) {
          return `Unknown subagent kind '${input.kind}'.`;
        }
        try {
          const modelName = input.model?.trim() || undefined;
          const modality =
            (await options.resolveModality(modelName)) ??
            (modelName ? null : getLlmModality(context.agent));
          const child = new Agent({
            name: `${options.parent}-${kind.id}`,
            systemPrompt: kind.instructions,
            model: options.createModel(modelName),
            appState: {
              ...(readAppStateString(context, "userId")
                ? { userId: readAppStateString(context, "userId") }
                : {}),
              ...(readAppStateString(context, "sessionId")
                ? { sessionId: readAppStateString(context, "sessionId") }
                : {}),
              "hooman.subagentKind": kind.id,
              ...(modality ? { [LLM_MODALITY_STATE_KEY]: modality } : {}),
            },
            tools: [...selectTools(kind, baseTools)],
            printer: false,
          });
          if (modality) {
            setLlmModality(child, modality);
          }
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
  ];
}
