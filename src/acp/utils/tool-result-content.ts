import type { ToolCallContent } from "@agentclientprotocol/sdk";
import type { FileToolDisplay } from "../../core/state/file-tool-display.js";

/**
 * ACP `diff` content for a file-modifying tool, when the tool captured the
 * before/after text. Returns `undefined` for non-file tools so the caller can
 * fall back to {@link toolResultToAcpContent}.
 */
export function fileToolDiffContent(
  display: FileToolDisplay | undefined,
): Array<ToolCallContent> | undefined {
  if (!display) {
    return undefined;
  }
  const files =
    display.files ??
    (display.path !== undefined && display.newText !== undefined
      ? [
          {
            path: display.path,
            oldText: display.oldText ?? null,
            newText: display.newText,
          },
        ]
      : []);
  return files.length > 0
    ? files.map((file) => ({ type: "diff" as const, ...file }))
    : undefined;
}

type ToolResultLike = {
  toolUseId: string;
  status: string;
  content?: unknown;
  toJSON?: () => unknown;
};

function capText(text: string, max = 12_000): string {
  return text.length > max ? `${text.slice(0, max)}\n...(truncated)` : text;
}

/**
 * Extract display text from the result's content blocks: text blocks pass
 * through verbatim (tools like read_file return plain text on purpose — do
 * not re-wrap it in JSON), JSON blocks are pretty-printed.
 */
function blocksToText(content: unknown): string | undefined {
  if (!Array.isArray(content) || content.length === 0) {
    return undefined;
  }
  const parts: string[] = [];
  for (const raw of content) {
    const block = raw as { type?: string; text?: unknown; json?: unknown };
    if (block?.type === "textBlock" && typeof block.text === "string") {
      parts.push(block.text);
    } else if (block?.type === "jsonBlock") {
      parts.push(JSON.stringify(block.json, null, 2));
    } else {
      return undefined; // media or unknown block: fall back to full JSON
    }
  }
  return parts.join("\n");
}

export function toolResultToAcpContent(
  result: ToolResultLike,
): Array<ToolCallContent> {
  let text: string;
  try {
    text =
      blocksToText(result.content) ??
      JSON.stringify(result.toJSON?.() ?? result, null, 2) ??
      "";
  } catch {
    text = JSON.stringify(
      { toolUseId: result.toolUseId, status: result.status },
      null,
      2,
    );
  }
  return [{ type: "content", content: { type: "text", text: capText(text) } }];
}
