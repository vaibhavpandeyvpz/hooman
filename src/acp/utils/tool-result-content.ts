import type { ToolCallContent } from "@agentclientprotocol/sdk";

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
