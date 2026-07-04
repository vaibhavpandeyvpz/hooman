import type { ToolCallContent } from "@agentclientprotocol/sdk";

/** Compact one-or-few-line rendering of a tool's rawInput args. */
export function toolInputText(rawInput: unknown): string {
  if (rawInput === undefined || rawInput === null) {
    return "";
  }
  if (typeof rawInput === "string") {
    return rawInput;
  }
  if (typeof rawInput !== "object") {
    return String(rawInput);
  }
  const entries = Object.entries(rawInput as Record<string, unknown>);
  if (entries.length === 0) {
    return "";
  }
  const lines: string[] = [];
  for (const [key, value] of entries) {
    const rendered = typeof value === "string" ? value : JSON.stringify(value);
    if (rendered === undefined) {
      continue;
    }
    lines.push(entries.length === 1 ? rendered : `${key}: ${rendered}`);
  }
  return lines.join("\n");
}

/** Joins any `content` text items into the tool's collapsible output detail. */
export function toolDetailText(content: ToolCallContent[]): string {
  const parts: string[] = [];
  for (const item of content) {
    if (item.type === "content" && item.content.type === "text") {
      parts.push(item.content.text);
    }
  }
  return parts.join("\n");
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
