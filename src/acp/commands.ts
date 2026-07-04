import type { AvailableCommand } from "@agentclientprotocol/sdk";

export type ParsedSlashCommand = { name: string; args: string };

/**
 * Slash commands Hooman advertises over ACP. Mode/model/effort/yolo are
 * intentionally omitted: ACP-aware clients (like the VS Code webview) expose
 * those as session config options (`session/setConfigOption`) with proper
 * pickers instead, so they don't need a text-command surface too. UI-only
 * ones (`/config`, `/new`, `/sessions`) are also omitted because the ACP
 * client owns that UX.
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
