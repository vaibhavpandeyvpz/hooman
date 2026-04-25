import { Agent } from "@strands-agents/sdk";
import type { BaseModelConfig, Model, Tool } from "@strands-agents/sdk";
import type { AgentDefinition, AgentKind } from "./definitions.ts";

export type AgentJob = {
  id: string;
  kind: AgentKind;
  description: string;
  prompt: string;
};

export type AgentJobResult = {
  id: string;
  kind: AgentKind;
  description: string;
  status: "completed" | "failed";
  content: string;
  durationMs: number;
  error: string | null;
  stopReason: string | null;
};

export type RunAgentJobsResult = {
  results: AgentJobResult[];
};

type RunAgentJobsOptions = {
  jobs: readonly AgentJob[];
  definitions: readonly AgentDefinition[];
  tools: readonly Tool[];
  createModel: () => Model<BaseModelConfig>;
  concurrency: number;
  parent: string;
  appState: {
    userId?: string;
    sessionId?: string;
  };
  cancelSignal?: AbortSignal;
};

function buildJobPrompt(job: AgentJob): string {
  return `Task: ${job.description}\n\nUser request:\n${job.prompt}`;
}

function selectTools(
  definition: AgentDefinition,
  tools: readonly Tool[],
): Tool[] {
  const byName = new Map<string, Tool>();
  for (const tool of tools) {
    byName.set(tool.name, tool);
  }
  const selected: Tool[] = [];
  for (const name of definition.tools) {
    const tool = byName.get(name);
    if (!tool) {
      throw new Error(
        `Agent '${definition.id}' cannot access missing tool '${name}'.`,
      );
    }
    selected.push(tool);
  }
  return selected;
}

async function runSingleJob(
  job: AgentJob,
  definition: AgentDefinition,
  options: Omit<RunAgentJobsOptions, "jobs" | "definitions" | "concurrency">,
): Promise<AgentJobResult> {
  const started = Date.now();
  try {
    const child = new Agent({
      name: `${options.parent}-${definition.id}-${job.id}`,
      systemPrompt: definition.instructionsText,
      model: options.createModel(),
      appState: {
        ...(options.appState.userId ? { userId: options.appState.userId } : {}),
        ...(options.appState.sessionId
          ? { sessionId: options.appState.sessionId }
          : {}),
        agentKind: definition.id,
      },
      tools: selectTools(definition, options.tools),
      printer: false,
    });
    const result = await child.invoke(buildJobPrompt(job), {
      ...(options.cancelSignal ? { cancelSignal: options.cancelSignal } : {}),
    });
    return {
      id: job.id,
      kind: job.kind,
      description: job.description,
      status: "completed",
      content: result.toString().trim(),
      durationMs: Date.now() - started,
      error: null,
      stopReason: result.stopReason,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      id: job.id,
      kind: job.kind,
      description: job.description,
      status: "failed",
      content: "",
      durationMs: Date.now() - started,
      error: message,
      stopReason: null,
    };
  }
}

export async function runAgentJobs(
  options: RunAgentJobsOptions,
): Promise<RunAgentJobsResult> {
  if (options.jobs.length === 0) {
    return { results: [] };
  }
  const defsByKind = new Map<AgentKind, AgentDefinition>(
    options.definitions.map((entry) => [entry.id, entry]),
  );
  const ordered = [...options.jobs];
  const results = new Array<AgentJobResult>(ordered.length);
  const workerCount = Math.max(
    1,
    Math.min(options.concurrency, ordered.length),
  );
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const idx = cursor;
      cursor += 1;
      if (idx >= ordered.length) {
        return;
      }
      const job = ordered[idx]!;
      const definition = defsByKind.get(job.kind);
      if (!definition) {
        results[idx] = {
          id: job.id,
          kind: job.kind,
          description: job.description,
          status: "failed",
          content: "",
          durationMs: 0,
          error: `Unknown agent kind '${job.kind}'.`,
          stopReason: null,
        };
        continue;
      }
      results[idx] = await runSingleJob(job, definition, {
        tools: options.tools,
        createModel: options.createModel,
        parent: options.parent,
        appState: options.appState,
        cancelSignal: options.cancelSignal,
      });
    }
  }
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return { results };
}
