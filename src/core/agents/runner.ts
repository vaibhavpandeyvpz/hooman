import { Agent, TextBlock } from "@strands-agents/sdk";
import { Graph, Node, Status } from "@strands-agents/sdk/multiagent";
import type {
  BaseModelConfig,
  Model,
  Tool,
  ContentBlock,
} from "@strands-agents/sdk";
import type {
  MultiAgentInput,
  MultiAgentState,
  MultiAgentStreamEvent,
  NodeInputOptions,
  NodeResultUpdate,
} from "@strands-agents/sdk/multiagent";
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

class JobNode extends Node {
  override readonly type = "agentJobNode";
  private readonly execute: () => Promise<AgentJobResult>;
  private readonly cancelSignal?: AbortSignal;

  constructor(
    id: string,
    execute: () => Promise<AgentJobResult>,
    description: string,
    cancelSignal?: AbortSignal,
  ) {
    super(id, { description });
    this.execute = execute;
    this.cancelSignal = cancelSignal;
  }

  override async *handle(
    _input: MultiAgentInput,
    _state: MultiAgentState,
    _options?: NodeInputOptions,
  ): AsyncGenerator<MultiAgentStreamEvent, NodeResultUpdate, undefined> {
    if (this.cancelSignal?.aborted) {
      return {
        status: Status.CANCELLED,
        content: [new TextBlock("Cancelled before job execution.")],
        error: new Error("Cancelled before job execution."),
      };
    }
    const result = await this.execute();
    if (result.status === "completed") {
      const content = result.content.trim()
        ? [new TextBlock(result.content.trim())]
        : [];
      return {
        status: Status.COMPLETED,
        content,
      };
    }
    return {
      status:
        result.stopReason === "cancelled" ? Status.CANCELLED : Status.FAILED,
      content: result.error ? [new TextBlock(result.error)] : [],
      error: result.error ? new Error(result.error) : undefined,
    };
  }
}

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
  if (options.cancelSignal?.aborted) {
    return {
      id: job.id,
      kind: job.kind,
      description: job.description,
      status: "failed",
      content: "",
      durationMs: 0,
      error: "Cancelled before execution.",
      stopReason: "cancelled",
    };
  }
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
      status: result.stopReason === "cancelled" ? "failed" : "completed",
      content: result.toString().trim(),
      durationMs: Date.now() - started,
      error: result.stopReason === "cancelled" ? "Cancelled." : null,
      stopReason: result.stopReason,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cancelled = options.cancelSignal?.aborted ?? false;
    return {
      id: job.id,
      kind: job.kind,
      description: job.description,
      status: "failed",
      content: "",
      durationMs: Date.now() - started,
      error: message,
      stopReason: cancelled ? "cancelled" : null,
    };
  }
}

function contentToText(content: readonly ContentBlock[]): string {
  return content
    .map((block) => {
      if ("text" in block && typeof block.text === "string") {
        return block.text;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

function cancelledResult(job: AgentJob, message: string): AgentJobResult {
  return {
    id: job.id,
    kind: job.kind,
    description: job.description,
    status: "failed",
    content: "",
    durationMs: 0,
    error: message,
    stopReason: "cancelled",
  };
}

export async function runAgentJobs(
  options: RunAgentJobsOptions,
): Promise<RunAgentJobsResult> {
  if (options.jobs.length === 0) {
    return { results: [] };
  }
  if (options.cancelSignal?.aborted) {
    return {
      results: options.jobs.map((job) => ({
        id: job.id,
        kind: job.kind,
        description: job.description,
        status: "failed",
        content: "",
        durationMs: 0,
        error: "Cancelled before execution.",
        stopReason: "cancelled",
      })),
    };
  }
  const defsByKind = new Map<AgentKind, AgentDefinition>(
    options.definitions.map((entry) => [entry.id, entry]),
  );
  const ordered = [...options.jobs];
  const results: Array<AgentJobResult | null> = ordered.map(() => null);
  const graphNodes: JobNode[] = [];
  const graphSources: string[] = [];
  const nodeToIndex = new Map<string, number>();
  const graphNodeResults = new Map<string, AgentJobResult>();

  for (const [index, job] of ordered.entries()) {
    const definition = defsByKind.get(job.kind);
    if (!definition) {
      results[index] = {
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
    const nodeId = `${job.id}__${index + 1}`;
    nodeToIndex.set(nodeId, index);
    graphSources.push(nodeId);
    graphNodes.push(
      new JobNode(
        nodeId,
        async () => {
          const jobResult = await runSingleJob(job, definition, {
            tools: options.tools,
            createModel: options.createModel,
            parent: options.parent,
            appState: options.appState,
            cancelSignal: options.cancelSignal,
          });
          graphNodeResults.set(nodeId, jobResult);
          return jobResult;
        },
        `${job.kind} :: ${job.description}`,
        options.cancelSignal,
      ),
    );
  }

  if (graphNodes.length > 0) {
    try {
      const graph = new Graph({
        id: "run_agents_graph",
        nodes: graphNodes,
        edges: [],
        sources: graphSources,
        maxConcurrency: Math.max(
          1,
          Math.min(options.concurrency, graphNodes.length),
        ),
      });
      const graphRun = graph.invoke("run jobs");
      const graphResult = options.cancelSignal
        ? await Promise.race([
            graphRun,
            new Promise<null>((resolve) => {
              const onAbort = () => resolve(null);
              options.cancelSignal?.addEventListener("abort", onAbort, {
                once: true,
              });
            }),
          ])
        : await graphRun;
      if (graphResult === null) {
        for (const [nodeId, index] of nodeToIndex.entries()) {
          if (results[index]) {
            continue;
          }
          const recorded = graphNodeResults.get(nodeId);
          results[index] =
            recorded ?? cancelledResult(ordered[index]!, "Cancelled.");
        }
        return {
          results: results.filter(
            (entry): entry is AgentJobResult => entry !== null,
          ),
        };
      }
      const nodeResultsById = new Map(
        graphResult.results.map((entry) => [entry.nodeId, entry] as const),
      );
      for (const [nodeId, index] of nodeToIndex.entries()) {
        const recorded = graphNodeResults.get(nodeId);
        if (recorded) {
          results[index] = recorded;
          continue;
        }
        const nodeResult = nodeResultsById.get(nodeId);
        const job = ordered[index]!;
        const cancelled = options.cancelSignal?.aborted ?? false;
        results[index] = {
          id: job.id,
          kind: job.kind,
          description: job.description,
          status:
            nodeResult?.status === Status.COMPLETED ? "completed" : "failed",
          content: nodeResult ? contentToText(nodeResult.content) : "",
          durationMs: nodeResult?.duration ?? 0,
          error:
            nodeResult?.error?.message ??
            "Job did not produce a result from Graph execution.",
          stopReason:
            nodeResult?.status === Status.CANCELLED || cancelled
              ? "cancelled"
              : null,
        };
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Graph execution failed.";
      for (const [nodeId, index] of nodeToIndex.entries()) {
        if (results[index]) {
          continue;
        }
        const job = ordered[index]!;
        results[index] = {
          id: job.id,
          kind: job.kind,
          description: job.description,
          status: "failed",
          content: "",
          durationMs: 0,
          error: message,
          stopReason: options.cancelSignal?.aborted ? "cancelled" : null,
        };
      }
    }
  }

  return {
    results: results.filter((entry): entry is AgentJobResult => entry !== null),
  };
}
