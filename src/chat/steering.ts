import { InterventionActions } from "@strands-agents/sdk";
import type {
  AfterModelCallEvent,
  BeforeToolCallEvent,
} from "@strands-agents/sdk";
import { SteeringHandler } from "@strands-agents/sdk/vended-interventions/steering";
import type { PromptSubmission } from "./components/prompt-input/hooks/usePromptInputController.js";

type QueuedSteeringPrompt = PromptSubmission;

function formatPrompt(prompt: QueuedSteeringPrompt): string {
  const text = prompt.text.trim();
  if (prompt.attachments.length === 0) {
    return text || "[empty prompt]";
  }

  const attachmentLines = prompt.attachments.map(
    (attachmentPath) => `[attachment] ${attachmentPath}`,
  );
  return [text || "[attachments only]", ...attachmentLines].join("\n");
}

function buildFeedback(prompts: readonly QueuedSteeringPrompt[]): string {
  const guidance = prompts
    .map((prompt, index) => `${index + 1}. ${formatPrompt(prompt)}`)
    .join("\n\n");

  return [
    "The user sent follow-up guidance while this turn was still running.",
    "Update your plan before continuing. Treat the following as current user steering:",
    guidance,
  ].join("\n\n");
}

export class ChatTurnSteeringController {
  private readonly queued: QueuedSteeringPrompt[] = [];

  public queue(prompts: readonly QueuedSteeringPrompt[]): boolean {
    if (prompts.length === 0) {
      return false;
    }
    this.queued.push(...prompts);
    return true;
  }

  public get hasPending(): boolean {
    return this.queued.length > 0;
  }

  public drainFeedback(): string | null {
    if (this.queued.length === 0) {
      return null;
    }
    const prompts = this.queued.splice(0, this.queued.length);
    return buildFeedback(prompts);
  }
}

export class ChatTurnSteeringIntervention extends SteeringHandler {
  public readonly name = "hooman:chat-turn-steering";

  public constructor(private readonly controller: ChatTurnSteeringController) {
    super();
  }

  public override beforeToolCall(
    _event: BeforeToolCallEvent,
  ):
    | ReturnType<typeof InterventionActions.proceed>
    | ReturnType<typeof InterventionActions.guide> {
    const feedback = this.controller.drainFeedback();
    return feedback
      ? InterventionActions.guide(feedback)
      : InterventionActions.proceed();
  }

  public override afterModelCall(
    event: AfterModelCallEvent,
  ):
    | ReturnType<typeof InterventionActions.proceed>
    | ReturnType<typeof InterventionActions.guide> {
    if (!event.stopData) {
      return InterventionActions.proceed();
    }
    const feedback = this.controller.drainFeedback();
    return feedback
      ? InterventionActions.guide(feedback)
      : InterventionActions.proceed();
  }
}

export function createChatTurnSteeringIntervention(
  controller: ChatTurnSteeringController,
): ChatTurnSteeringIntervention {
  return new ChatTurnSteeringIntervention(controller);
}
