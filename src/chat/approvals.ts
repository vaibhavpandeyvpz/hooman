import { BeforeToolCallEvent } from "@strands-agents/sdk";
import type { Config } from "../core/config.ts";
import type { ApprovalDecision, ApprovalRequest } from "./types.ts";

const INTERNAL_ALWAYS_ALLOWED = new Set(["strands_structured_output"]);
const INPUT_PREVIEW_LIMIT = 256;

function previewInput(input: unknown): string {
  try {
    const text = JSON.stringify(input, null, 2) ?? "null";
    return text.length > INPUT_PREVIEW_LIMIT
      ? `${text.slice(0, INPUT_PREVIEW_LIMIT)}\n... (truncated)`
      : text;
  } catch {
    return String(input);
  }
}

type QueueItem = {
  request: ApprovalRequest;
  resolve: (decision: ApprovalDecision) => void;
};

export class ChatApprovalController {
  private readonly queue: QueueItem[] = [];
  private readonly listeners = new Set<() => void>();
  private nextId = 0;

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public get pending(): ApprovalRequest | null {
    return this.queue[0]?.request ?? null;
  }

  public request(event: BeforeToolCallEvent): Promise<ApprovalDecision> {
    const request: ApprovalRequest = {
      id: String(this.nextId++),
      toolName: event.toolUse.name,
      description: event.tool?.description?.trim(),
      inputPreview: previewInput(event.toolUse.input),
    };
    return new Promise<ApprovalDecision>((resolve) => {
      this.queue.push({ request, resolve });
      this.emit();
    });
  }

  public decide(decision: ApprovalDecision): void {
    const item = this.queue.shift();
    if (!item) {
      return;
    }
    item.resolve(decision);
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export function createChatApprovalHandler(
  config: Config,
  controller: ChatApprovalController,
  options?: { yolo?: boolean },
): (event: BeforeToolCallEvent) => Promise<void> {
  return async (event: BeforeToolCallEvent) => {
    const toolName = event.toolUse.name;
    if (options?.yolo) {
      return;
    }
    if (
      INTERNAL_ALWAYS_ALLOWED.has(toolName) ||
      config.tools.allowed.includes(toolName)
    ) {
      return;
    }

    const decision = await controller.request(event);
    if (decision === "allow") {
      return;
    }
    if (decision === "always") {
      if (!config.tools.allowed.includes(toolName)) {
        config.update({
          tools: { allowed: [...config.tools.allowed, toolName] },
        });
      }
      return;
    }
    event.cancel = `Tool "${toolName}" was rejected by the user.`;
  };
}
