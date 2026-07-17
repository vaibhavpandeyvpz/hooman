import type { DaemonSessionCard, DaemonTurnPhase } from "../dashboard/types.js";
import type { DaemonDisposeReason } from "../session-registry.js";

export function formatElapsed(fromMs: number, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((nowMs - fromMs) / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${seconds % 60}s`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function phaseLabel(phase: DaemonTurnPhase | undefined): string {
  switch (phase) {
    case "queued":
      return "queued";
    case "waiting_slot":
      return "waiting for slot";
    case "setting_up":
      return "setting up session";
    case "generating":
      return "generating";
    case "tool":
      return "tool";
    case "approval":
      return "awaiting approval";
    case "draining":
      return "draining";
    default:
      return "active";
  }
}

export function disposeReasonLabel(
  reason: DaemonDisposeReason | undefined,
): string {
  switch (reason) {
    case "idle_timeout":
      return "idle timeout";
    case "pool_pressure":
      return "pool pressure";
    case "shutdown":
      return "shutdown";
    case "child_exit":
      return "acp child restart";
    default:
      return "closed";
  }
}

export function originLabel(card: DaemonSessionCard): string {
  const origin = card.origin;
  if (!origin) {
    return card.externalKey;
  }
  const parts = [origin.server];
  if (origin.thread) {
    parts.push(`#${origin.thread}`);
  } else if (origin.session) {
    parts.push(origin.session);
  }
  return parts.join(" \u00b7 ");
}

export function sessionSuffix(acpSessionId: string | undefined): string {
  if (!acpSessionId) {
    return "";
  }
  return acpSessionId.slice(-6);
}
