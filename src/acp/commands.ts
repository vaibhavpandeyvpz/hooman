import type { AvailableCommand } from "@agentclientprotocol/sdk";
import { formatModeNames } from "../core/modes/definitions.js";

export type ParsedSlashCommand = { name: string; args: string };

/**
 * Slash commands Hooman advertises over ACP. These mirror the non-interactive
 * subset of the chat TUI's commands; UI-only ones (`/config`, `/new`,
 * `/sessions`) are intentionally omitted because the ACP client owns that UX.
 *
 * See https://agentclientprotocol.com/protocol/v1/slash-commands
 */
export const ACP_SLASH_COMMANDS: readonly AvailableCommand[] = [
  {
    name: "compact",
    description: "Compact conversation history now.",
  },
  {
    name: "init",
    description: "Generate or refresh AGENTS.md for this project.",
    input: { hint: "optional extra guidance" },
  },
  {
    name: "mode",
    description: `Switch session mode (${formatModeNames()}).`,
    input: { hint: "agent | ask | plan" },
  },
  {
    name: "model",
    description: "Switch the language model for this session.",
    input: { hint: "model name (blank to list)" },
  },
  {
    name: "effort",
    description: "Set the reasoning effort for this session.",
    input: { hint: "minimal | low | medium | high | off (blank to list)" },
  },
  {
    name: "yolo",
    description: "Auto-approve tool calls without prompting.",
    input: { hint: "on | off" },
  },
];

const COMMAND_NAMES = new Set(ACP_SLASH_COMMANDS.map((cmd) => cmd.name));

/**
 * Parse a leading `/command [args]` out of prompt text. Returns `null` unless
 * the text starts with a recognized command name.
 */
export function parseAcpSlashCommand(text: string): ParsedSlashCommand | null {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("/")) {
    return null;
  }
  const match = /^\/([a-zA-Z][\w-]*)(?:[ \t]+([\s\S]*))?$/.exec(trimmed);
  if (!match) {
    return null;
  }
  const name = match[1]!.toLowerCase();
  if (!COMMAND_NAMES.has(name)) {
    return null;
  }
  return { name, args: (match[2] ?? "").trim() };
}

/** Coerce a yolo toggle argument to a boolean, or `undefined` if unrecognized. */
export function parseYoloToggle(raw: string): boolean | undefined {
  const t = raw.trim().toLowerCase();
  if (["on", "true", "1", "yes", "enable", "enabled"].includes(t)) {
    return true;
  }
  if (["off", "false", "0", "no", "disable", "disabled"].includes(t)) {
    return false;
  }
  return undefined;
}
