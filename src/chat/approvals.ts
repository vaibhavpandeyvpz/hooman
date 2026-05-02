import { BeforeToolCallEvent } from "@strands-agents/sdk";
import {
  INTERNAL_ALWAYS_ALLOWED,
  allowToolForSession,
  isToolSessionAllowed,
} from "../core/state/tool-approvals.js";
import { isYoloEnabled } from "../core/state/yolo.js";
import type { ApprovalDecision, ApprovalRequest } from "./types.js";
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
  controller: ChatApprovalController,
): (event: BeforeToolCallEvent) => Promise<void> {
  return async (event: BeforeToolCallEvent) => {
    const toolName = event.toolUse.name;
    if (isYoloEnabled(event.agent)) {
      return;
    }
    if (
      INTERNAL_ALWAYS_ALLOWED.has(toolName) ||
      isToolSessionAllowed(event.agent, toolName, event.toolUse.input)
    ) {
      return;
    }

    const decision = await controller.request(event);
    if (decision === "allow") {
      return;
    }
    if (decision === "always") {
      allowToolForSession(event.agent, toolName);
      return;
    }
    event.cancel = `Tool "${toolName}" was rejected by the user.`;
  };
}
