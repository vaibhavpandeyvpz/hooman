import { InterventionActions } from "@strands-agents/sdk";
import type {
  AfterModelCallEvent,
  BeforeToolCallEvent,
} from "@strands-agents/sdk";
import { SteeringHandler } from "@strands-agents/sdk/vended-interventions/steering";

/**
 * One message queued to steer a running turn — mirrors a prompt submission
 * (freeform text plus resolved attachment paths) without depending on any
 * particular front-end's prompt-input type.
 */
export type QueuedSteeringPrompt = {
  text: string;
  attachments: string[];
};

function formatSteeringPrompt(prompt: QueuedSteeringPrompt): string {
  const text = prompt.text.trim();
  if (prompt.attachments.length === 0) {
    return text || "[empty prompt]";
  }

  const attachmentLines = prompt.attachments.map(
    (attachmentPath) => `[attachment] ${attachmentPath}`,
  );
  return [text || "[attachments only]", ...attachmentLines].join("\n");
}

function buildSteeringFeedback(
  prompts: readonly QueuedSteeringPrompt[],
): string {
  const guidance = prompts
    .map((prompt, index) => `${index + 1}. ${formatSteeringPrompt(prompt)}`)
    .join("\n\n");

  return [
    "The user sent follow-up guidance while this turn was still running.",
    "Update your plan before continuing. Treat the following as current user steering:",
    guidance,
  ].join("\n\n");
}

/**
 * Buffers messages sent while a turn is already running so they can be
 * injected into the *current* turn via {@link ChatTurnSteeringIntervention}
 * instead of waiting in line for a brand new one. Front-ends (chat TUI, ACP
 * bridge, a web client, etc.) push into this from their own "send message"
 * handler whenever a turn is already in flight.
 */
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
    return buildSteeringFeedback(prompts);
  }
}

/**
 * Injects {@link ChatTurnSteeringController} feedback into the running turn
 * via the `@strands-agents/sdk` steering intervention contract — on the next
 * tool call, or (if the turn is about to stop) on the model's stop event, so
 * "steered" guidance lands before the turn would otherwise finish.
 */
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
