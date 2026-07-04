import type {
  AskUserBackend,
  AskUserRequest,
  AskUserResponse,
} from "../core/tools/ask-user.js";

export type ChatQuestion = {
  id: string;
  question: string;
  options: string[];
};

type QueueItem = {
  request: ChatQuestion;
  resolve: (response: AskUserResponse) => void;
};

/**
 * FIFO queue bridging the `ask_user` tool (which blocks inside its callback)
 * to the Ink chrome, mirroring {@link ChatApprovalController}: the tool awaits
 * `request()`, the UI renders `pending` and calls `answer()`/`dismiss()`.
 */
export class ChatQuestionController {
  private readonly queue: QueueItem[] = [];
  private readonly listeners = new Set<() => void>();
  private nextId = 0;

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public get pending(): ChatQuestion | null {
    return this.queue[0]?.request ?? null;
  }

  public request(request: AskUserRequest): Promise<AskUserResponse> {
    const queued: ChatQuestion = {
      id: String(this.nextId++),
      question: request.question,
      options: request.options,
    };
    return new Promise<AskUserResponse>((resolve) => {
      const item: QueueItem = { request: queued, resolve };
      this.queue.push(item);
      if (request.signal) {
        const onAbort = () => {
          const index = this.queue.indexOf(item);
          if (index !== -1) {
            this.queue.splice(index, 1);
            resolve({ kind: "dismissed" });
            this.emit();
          }
        };
        if (request.signal.aborted) {
          onAbort();
          return;
        }
        request.signal.addEventListener("abort", onAbort, { once: true });
      }
      this.emit();
    });
  }

  public answer(answer: string): void {
    this.resolveNext({ kind: "answered", answer });
  }

  public dismiss(): void {
    this.resolveNext({ kind: "dismissed" });
  }

  private resolveNext(response: AskUserResponse): void {
    const item = this.queue.shift();
    if (!item) {
      return;
    }
    item.resolve(response);
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export function createChatAskUserBackend(
  controller: ChatQuestionController,
): AskUserBackend {
  return {
    ask: (request) => controller.request(request),
  };
}
