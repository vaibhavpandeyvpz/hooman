import {
  tool,
  type JSONValue,
  type Tool,
  type ToolContext,
} from "@strands-agents/sdk";
import type { BaseModelConfig, Model } from "@strands-agents/sdk";
import { z } from "zod";
import type { ResearchSubagentDefinition } from "./research.js";
import { runSubagentJobs } from "./runner.js";

export const RUN_SUBAGENTS_TOOL_NAME = "run_subagents";

const JobSchema = z.object({
  kind: z.enum(["research"]),
  description: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
});

const RunSubagentsInputSchema = z.object({
  jobs: z.array(JobSchema).min(1),
  maxConcurrency: z.coerce.number().int().min(1).optional(),
});

type RunSubagentToolsOptions = {
  parent: string;
  research: ResearchSubagentDefinition;
  tools: readonly Tool[];
  createModel: () => Model<BaseModelConfig>;
  concurrency: number;
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

export function createRunSubagentTools(options: RunSubagentToolsOptions) {
  const baseTools = options.tools.filter(
    (entry) => entry.name !== RUN_SUBAGENTS_TOOL_NAME,
  );
  return [
    tool({
      name: RUN_SUBAGENTS_TOOL_NAME,
      description: `Run one or more specialized child agents in parallel and return their outputs.
Use this for deeper investigation of the workspace and sources when work can be split into independent jobs.
Available agent kinds:
- ${options.research.id}: ${options.research.description}`,
      inputSchema: RunSubagentsInputSchema,
      callback: async (input, context?: ToolContext) => {
        if (!context) {
          throw new Error(
            `${RUN_SUBAGENTS_TOOL_NAME} requires execution context.`,
          );
        }
        const concurrency = Math.max(
          1,
          Math.min(
            input.maxConcurrency ?? options.concurrency,
            input.jobs.length,
          ),
        );
        const jobs = input.jobs.map((job, index) => ({
          id: `job-${index + 1}`,
          kind: job.kind,
          description: job.description,
          prompt: job.prompt,
        }));
        const result = await runSubagentJobs({
          jobs,
          research: options.research,
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
