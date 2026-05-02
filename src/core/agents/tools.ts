import {
  tool,
  type JSONValue,
  type Tool,
  type ToolContext,
} from "@strands-agents/sdk";
import type { BaseModelConfig, Model } from "@strands-agents/sdk";
import { z } from "zod";
import { BUILTIN_AGENT_KINDS, type AgentDefinition } from "./definitions.js";
import { runAgentJobs } from "./runner.js";

export const RUN_AGENTS_TOOL_NAME = "run_agents";

const JobSchema = z.object({
  kind: z.enum(BUILTIN_AGENT_KINDS),
  description: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
});

const RunAgentsInputSchema = z.object({
  jobs: z.array(JobSchema).min(1),
  maxConcurrency: z.coerce.number().int().min(1).optional(),
});

type RunAgentsToolOptions = {
  parent: string;
  definitions: readonly AgentDefinition[];
  tools: readonly Tool[];
  createModel: () => Model<BaseModelConfig>;
  defaultConcurrency: number;
};

function toJsonValue(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

function readAppStateString(
  context: ToolContext,
  key: "userId" | "sessionId",
): string | undefined {
  const value = context.agent.appState.get(key);
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function createRunAgentsTools(options: RunAgentsToolOptions) {
  const kinds = options.definitions.map(
    (entry) => `- ${entry.id}: ${entry.description}`,
  );
  const baseTools = options.tools.filter(
    (entry) => entry.name !== RUN_AGENTS_TOOL_NAME,
  );
  return [
    tool({
      name: RUN_AGENTS_TOOL_NAME,
      description: `Run one or more specialized child agents in parallel and return their outputs.
Use this for deeper investigation of the workspace and sources when work can be split into independent jobs.
Available agent kinds:
${kinds.join("\n")}`,
      inputSchema: RunAgentsInputSchema,
      callback: async (input, context?: ToolContext) => {
        if (!context) {
          throw new Error(
            `${RUN_AGENTS_TOOL_NAME} requires execution context.`,
          );
        }
        const concurrency = Math.max(
          1,
          Math.min(
            input.maxConcurrency ?? options.defaultConcurrency,
            input.jobs.length,
          ),
        );
        const jobs = input.jobs.map((job, index) => ({
          id: `job-${index + 1}`,
          kind: job.kind,
          description: job.description,
          prompt: job.prompt,
        }));
        const result = await runAgentJobs({
          jobs,
          definitions: options.definitions,
          tools: baseTools,
          createModel: options.createModel,
          concurrency,
          parent: options.parent,
          appState: {
            userId: readAppStateString(context, "userId"),
            sessionId: readAppStateString(context, "sessionId"),
          },
          cancelSignal: context.agent.cancelSignal,
        });
        return toJsonValue({
          requestedJobs: jobs.length,
          concurrency,
          ...result,
        });
      },
    }),
  ];
}
