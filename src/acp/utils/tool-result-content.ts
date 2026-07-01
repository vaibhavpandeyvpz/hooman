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
  if (!display || display.path === undefined || display.newText === undefined) {
    return undefined;
  }
  return [
    {
      type: "diff",
      path: display.path,
      oldText: display.oldText ?? null,
      newText: display.newText,
    },
  ];
}

type ToolResultLike = {
  toolUseId: string;
  status: string;
  toJSON?: () => unknown;
};

function capText(text: string, max = 12_000): string {
  return text.length > max ? `${text.slice(0, max)}\n...(truncated)` : text;
}

export function toolResultToAcpContent(
  result: ToolResultLike,
): Array<ToolCallContent> {
  let text: string;
  try {
    text = JSON.stringify(result.toJSON?.() ?? result, null, 2) ?? "";
  } catch {
    text = JSON.stringify(
      { toolUseId: result.toolUseId, status: result.status },
      null,
      2,
    );
  }
  return [{ type: "content", content: { type: "text", text: capText(text) } }];
}
