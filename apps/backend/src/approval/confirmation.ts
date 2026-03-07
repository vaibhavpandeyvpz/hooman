/**
 * Parses user reply to an approval prompt. Used for HITL tool approval (Web, Slack, WhatsApp).
 */
export type ConfirmationResult =
  | "confirm" // allow this time
  | "allow_every_time"
  | "reject"
  | "none";

const CONFIRM_PATTERN = /^(y|yes|ok)$/i;
const ALLOW_EVERY_TIME_PATTERN =
  /^(always|allow\s+always|allow\s+every\s*time)$/i;
const REJECT_PATTERN = /^(n|no)$/i;

/**
 * Normalize and classify a confirmation reply.
 * - confirm: y, yes, ok → allow this time
 * - allow_every_time: always, allow always, allow every time
 * - reject: n, no
 * - none: anything else (treat as new message)
 */
export function parseConfirmationReply(text: string): ConfirmationResult {
  const normalized = (typeof text === "string" ? text : "")
    .trim()
    .toLowerCase();
  if (!normalized) return "none";
  if (CONFIRM_PATTERN.test(normalized)) return "confirm";
  if (ALLOW_EVERY_TIME_PATTERN.test(normalized)) return "allow_every_time";
  if (REJECT_PATTERN.test(normalized)) return "reject";
  return "none";
}
