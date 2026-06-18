import type { ApprovalDecision, ApprovalRequest } from "./types.js";
import { HoomanToolApprovalIntervention } from "../core/approvals/intervention.js";
import type { ToolApprovalRequest } from "../core/approvals/intervention.js";

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

  public request(request: ToolApprovalRequest): Promise<ApprovalDecision> {
    const queued: ApprovalRequest = {
      id: String(this.nextId++),
      toolName: request.toolName,
      description: request.description,
      inputPreview: request.inputPreview,
    };
    return new Promise<ApprovalDecision>((resolve) => {
      this.queue.push({ request: queued, resolve });
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

export function createChatApprovalIntervention(
  controller: ChatApprovalController,
){
  return new HoomanToolApprovalIntervention({
    ask: async (request) => controller.request(request),
  });
}
