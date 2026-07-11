import type {
  ApprovalDecision,
  ApprovalRequest,
  ApprovalResolution,
} from "./types.js";
import { HoomanToolApprovalIntervention } from "../core/approvals/intervention.js";
import type {
  ToolApprovalRequest,
  ToolApprovalResult,
} from "../core/approvals/intervention.js";

type QueueItem = {
  request: ApprovalRequest;
  resolve: (resolution: ApprovalResolution) => void;
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

  public request(request: ToolApprovalRequest): Promise<ApprovalResolution> {
    const queued: ApprovalRequest = {
      id: String(this.nextId++),
      toolName: request.toolName,
      description: request.description,
      inputPreview: request.inputPreview,
      input: request.input,
      ...(request.preview ? { preview: request.preview } : {}),
      ...(request.currentMode ? { currentMode: request.currentMode } : {}),
      ...(request.targetMode ? { targetMode: request.targetMode } : {}),
    };
    return new Promise<ApprovalResolution>((resolve) => {
      this.queue.push({ request: queued, resolve });
      this.emit();
    });
  }

  public decide(decision: ApprovalDecision, reason?: string): void {
    const item = this.queue.shift();
    if (!item) {
      return;
    }
    item.resolve(
      reason?.trim() ? { decision, reason: reason.trim() } : { decision },
    );
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
) {
  return new HoomanToolApprovalIntervention({
    ask: async (request): Promise<ToolApprovalResult> => {
      const resolution = await controller.request(request);
      if (resolution.decision === "reject") {
        return resolution.reason
          ? { decision: "reject", reason: resolution.reason }
          : "reject";
      }
      return resolution.decision;
    },
  });
}
