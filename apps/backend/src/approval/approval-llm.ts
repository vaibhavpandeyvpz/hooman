/**
 * Isolated LLM calls for tool-approval flow (no chat history).
 * 1) Format tool-approval message for the channel (web / Slack / WhatsApp).
 * 2) Classify user reply into y | ya | n | na (na = not applicable → continue chat, ignore approval).
 */
import createDebug from "debug";
import { generateText } from "ai";
import { getConfig } from "../config.js";
import { getHoomanModel } from "../agents/model-provider.js";
import {
  getApprovalFormatSystemPrompt,
  getApprovalParseReplyPrompt,
} from "../utils/prompts.js";

const debug = createDebug("hooman:approval-llm");

export type ApprovalChannel = "api" | "slack" | "whatsapp";

/** Reply label from LLM: y = allow once, ya = allow every time, n = reject, na = not applicable (treat as normal message). */
export type ApprovalReplyLabel = "y" | "ya" | "n" | "na";

/**
 * Format a tool-approval request as a short, human-readable prompt with channel-appropriate formatting.
 * Single isolated call; no context or chat history.
 */
export async function formatApprovalMessageWithLlm(
  channel: ApprovalChannel,
  toolName: string,
  argsPreview: string,
): Promise<string> {
  const config = getConfig();
  const model = getHoomanModel(config);
  const argsDisplay =
    argsPreview.length > 80 ? `${argsPreview.slice(0, 80)}…` : argsPreview;

  const system = getApprovalFormatSystemPrompt(channel);
  const prompt = `Tool: ${toolName}\nArguments preview: ${argsDisplay}\nChannel: ${channel}\n\nOutput the approval message only:`;

  try {
    const timeoutMs = config.TOOL_APPROVAL_FORMAT_TIMEOUT_MS ?? 60_000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const { text } = await generateText({
      model,
      system,
      prompt,
      abortSignal: controller.signal,
    });
    clearTimeout(timeout);
    const result = (text ?? "").trim();
    if (result) return result;
  } catch (err) {
    debug("formatApprovalMessageWithLlm error: %s", err);
  }
  return "";
}

/**
 * Classify the user's reply to an approval prompt into a single label.
 * Single isolated call; no context or chat history.
 * Includes the approval message text so the LLM can interpret the user's reply in context.
 * - y = allow this time
 * - ya = allow every time
 * - n = reject
 * - na = not applicable / unrelated → do not consume pending approval; treat as normal user message.
 */
export async function parseApprovalReplyWithLlm(
  userReply: string,
  toolName?: string,
  approvalMessage?: string,
): Promise<ApprovalReplyLabel> {
  const trimmed = (userReply ?? "").trim();
  if (!trimmed) return "na";

  const config = getConfig();
  const model = getHoomanModel(config);

  const system = getApprovalParseReplyPrompt();
  let prompt = `User reply: "${trimmed}"\n`;
  if (approvalMessage) {
    prompt += `\nThe approval prompt that was shown to the user:\n"${approvalMessage}"\n`;
  }
  if (toolName) {
    prompt += `\nTool that was awaiting approval: ${toolName}\n`;
  }
  prompt += `\nClassification (y/ya/n/na):`;

  try {
    const timeoutMs = config.TOOL_APPROVAL_PARSE_TIMEOUT_MS ?? 60_000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const { text } = await generateText({
      model,
      system,
      prompt,
      abortSignal: controller.signal,
    });
    clearTimeout(timeout);
    const raw = (text ?? "").trim().toLowerCase();
    const token = raw.split(/\s/)[0] ?? raw;
    if (token === "y" || token === "ya" || token === "n" || token === "na")
      return token;
  } catch (err) {
    debug("parseApprovalReplyWithLlm error: %s", err);
  }
  return "na";
}
