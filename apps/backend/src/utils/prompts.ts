import { readFile } from "fs/promises";
import { join } from "path";
import createDebug from "debug";
import { BACKEND_ROOT } from "../env.js";
import type { ChannelsConfig } from "../types.js";

const debug = createDebug("hooman:prompts");

const PROMPTS_DIR = join(BACKEND_ROOT, "prompts");

interface PromptCache {
  defaultAgentInstructions?: string;
  staticAppend?: string;
  channelSlack?: string;
  channelWhatsapp?: string;
  channelApi?: string;
  approvalFormat?: string;
  approvalParseReply?: string;
}

const cache: PromptCache = {};

async function loadOne(
  key: keyof PromptCache,
  filename: string,
): Promise<void> {
  const path = join(PROMPTS_DIR, filename);
  try {
    const content = await readFile(path, "utf-8");
    cache[key] = content;
    debug("loaded prompt %s from %s", key, path);
  } catch (err) {
    debug("prompt file not loaded %s: %o", path, err);
  }
}

/**
 * Load all prompt files from apps/backend/prompts/ into memory.
 * Call once at startup. Files are expected to exist.
 */
export async function loadPrompts(): Promise<void> {
  await Promise.all([
    loadOne("defaultAgentInstructions", "default-agent-instructions.md"),
    loadOne("staticAppend", "static-append.md"),
    loadOne("channelSlack", "channel-slack.md"),
    loadOne("channelWhatsapp", "channel-whatsapp.md"),
    loadOne("channelApi", "channel-api.md"),
    loadOne("approvalFormat", "approval-format.md"),
    loadOne("approvalParseReply", "approval-parse-reply.md"),
  ]);
}

export function getDefaultAgentInstructions(): string {
  return cache.defaultAgentInstructions ?? "";
}

export function getStaticAppend(): string {
  return cache.staticAppend ?? "";
}

export function getChannelSlackInstructions(): string {
  return cache.channelSlack ?? "";
}

export function getChannelWhatsAppInstructions(): string {
  return cache.channelWhatsapp ?? "";
}

export function getChannelApiInstructions(): string {
  return cache.channelApi ?? "";
}

/**
 * System prompt for the approval format LLM call. Reuses channel-specific formatting from prompts.
 * For api (web): output only the descriptive part; no reply instructions (web uses buttons).
 */
export function getApprovalFormatSystemPrompt(
  channel: "api" | "slack" | "whatsapp",
): string {
  const base = cache.approvalFormat ?? "";
  const channelRules =
    channel === "api"
      ? (cache.channelApi ?? "")
      : channel === "slack"
        ? (cache.channelSlack ?? "")
        : (cache.channelWhatsapp ?? "");
  const apiNote =
    channel === "api"
      ? "\n\nFor this channel (api/web): output ONLY the descriptive sentence. Do NOT add reply instructions (y/yes, always, n/no); the web UI uses buttons."
      : "";
  return base + "\n\n---\n\n" + channelRules + apiNote;
}

export function getApprovalParseReplyPrompt(): string {
  return cache.approvalParseReply ?? "";
}

/**
 * Full static instructions: base + channel-specific formatting (only for enabled channels).
 * Call with getChannelsConfig() from config to avoid circular dependency.
 */
export function getFullStaticAgentInstructionsAppend(
  channels: ChannelsConfig,
): string {
  let out = getStaticAppend();
  if (channels.slack?.enabled) {
    out += getChannelSlackInstructions();
  }
  if (channels.whatsapp?.enabled) {
    out += getChannelWhatsAppInstructions();
  }
  return out;
}

export interface BuildAgentSystemPromptParams {
  userInstructions: string;
  staticAppend: string;
  skillsSection: string;
  sessionId?: string;
}

/**
 * Build the full agent system prompt: user instructions + static append + skills section + optional session instructions.
 * Caller should pass empty skillsSection when skills MCP is not enabled.
 */
export function buildAgentSystemPrompt(
  params: BuildAgentSystemPromptParams,
): string {
  const { userInstructions, staticAppend, skillsSection, sessionId } = params;
  const sessionInstructions = sessionId
    ? `\n\nYour current sessionId is: ${sessionId}. Use this for session-scoped memory tools.\n`
    : "";
  return userInstructions + staticAppend + skillsSection + sessionInstructions;
}
