import type { ContentBlock as AcpContentBlock } from "@agentclientprotocol/sdk";
import {
  Agent as StrandsAgent,
  DocumentBlock,
  ImageBlock,
  Message,
  TextBlock,
} from "@strands-agents/sdk";
import type { ContentBlock } from "@strands-agents/sdk";

type AgentStreamInput = Parameters<
  InstanceType<typeof StrandsAgent>["stream"]
>[0];

function decodeBase64(data: string): Uint8Array {
  return new Uint8Array(Buffer.from(data, "base64"));
}

function mimeToImageFormat(mime: string): "png" | "jpeg" | "gif" | "webp" {
  const m = mime.toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpeg";
  if (m.includes("gif")) return "gif";
  if (m.includes("webp")) return "webp";
  return "png";
}

function mimeToDocFormat(
  mime: string,
): "pdf" | "html" | "txt" | "md" | "json" | "xml" | "csv" {
  const m = mime.toLowerCase();
  if (m.includes("pdf")) return "pdf";
  if (m.includes("html")) return "html";
  if (m.includes("markdown") || m.endsWith("/md")) return "md";
  if (m.includes("json")) return "json";
  if (m.includes("xml")) return "xml";
  if (m.includes("csv")) return "csv";
  return "txt";
}

function acpBlockToStrands(block: AcpContentBlock): ContentBlock[] {
  switch (block.type) {
    case "text":
      return [new TextBlock(block.text)];
    case "resource_link":
      return [
        new TextBlock(
          `[resource_link name=${JSON.stringify(block.name)} uri=${JSON.stringify(block.uri)}]`,
        ),
      ];
    case "resource": {
      const r = block.resource;
      if ("text" in r) {
        return [new TextBlock(r.text)];
      }
      const bytes = decodeBase64(r.blob);
      const mime = (r.mimeType ?? "application/octet-stream").toLowerCase();
      if (mime.startsWith("image/")) {
        return [
          new ImageBlock({
            format: mimeToImageFormat(mime),
            source: { bytes },
          }),
        ];
      }
      return [
        new DocumentBlock({
          format: mimeToDocFormat(mime),
          name: r.uri.split("/").pop() ?? "attachment",
          source: { bytes },
        }),
      ];
    }
    case "image": {
      const bytes = decodeBase64(block.data);
      return [
        new ImageBlock({
          format: mimeToImageFormat(block.mimeType),
          source: { bytes },
        }),
      ];
    }
    case "audio": {
      const bytes = decodeBase64(block.data);
      return [
        new TextBlock(
          `[audio mimeType=${JSON.stringify(block.mimeType)} bytes=${bytes.byteLength}]`,
        ),
        new DocumentBlock({
          format: "txt",
          name: "audio.bin",
          source: { bytes },
        }),
      ];
    }
    default:
      return [
        new TextBlock(
          `[unsupported ACP block ${JSON.stringify(block as unknown)}]`,
        ),
      ];
  }
}

/**
 * Convert an ACP `session/prompt` payload to Strands {@link InvokeArgs} (multimodal user turn).
 */
export function acpPromptToInvokeArgs(
  prompt: AcpContentBlock[],
): AgentStreamInput {
  const parts: ContentBlock[] = [];
  for (const block of prompt) {
    parts.push(...acpBlockToStrands(block));
  }
  return [new Message({ role: "user", content: parts })];
}

/** Flattened text for `user_message_chunk` echoes (lossy but readable). */
export function acpPromptEchoText(prompt: AcpContentBlock[]): string {
  const lines: string[] = [];
  for (const block of prompt) {
    switch (block.type) {
      case "text":
        lines.push(block.text);
        break;
      case "resource_link":
        lines.push(`[resource_link ${block.name}](${block.uri})`);
        break;
      case "resource":
        if ("text" in block.resource) {
          lines.push(block.resource.text);
        } else {
          lines.push(
            `[binary resource uri=${block.resource.uri} mime=${block.resource.mimeType ?? ""} len=${block.resource.blob.length}]`,
          );
        }
        break;
      case "image":
        lines.push(`[image ${block.mimeType} ${block.data.length} b64 chars]`);
        break;
      case "audio":
        lines.push(`[audio ${block.mimeType} ${block.data.length} b64 chars]`);
        break;
      default:
        lines.push(JSON.stringify(block));
    }
  }
  return lines.join("\n\n").trim();
}
