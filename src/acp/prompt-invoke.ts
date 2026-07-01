import type {
  ContentBlock as AcpContentBlock,
  BlobResourceContents,
  ResourceLink,
  TextResourceContents,
} from "@agentclientprotocol/sdk";
import {
  Agent as StrandsAgent,
  DocumentBlock,
  ImageBlock,
  Message,
  TextBlock,
  VideoBlock,
} from "@strands-agents/sdk";
import type {
  ContentBlock,
  DocumentFormat,
  ImageFormat,
  VideoFormat,
} from "@strands-agents/sdk";

type AgentStreamInput = Parameters<
  InstanceType<typeof StrandsAgent>["stream"]
>[0];

function decodeBase64(data: string): Uint8Array {
  return new Uint8Array(Buffer.from(data, "base64"));
}

function basename(uri: string): string {
  const trimmed = uri.split(/[?#]/, 1)[0] ?? uri;
  const tail = trimmed.split("/").pop();
  return tail && tail.length > 0 ? tail : "attachment";
}

function imageFormatFromMime(mime: string): ImageFormat {
  const m = mime.toLowerCase();
  if (m.includes("jpeg") || m.includes("jpg")) return "jpeg";
  if (m.includes("gif")) return "gif";
  if (m.includes("webp")) return "webp";
  return "png";
}

function videoFormatFromMime(mime: string): VideoFormat | undefined {
  const m = mime.toLowerCase();
  if (m.includes("mp4")) return "mp4";
  if (m.includes("webm")) return "webm";
  if (m.includes("quicktime") || m.includes("mov")) return "mov";
  if (m.includes("matroska") || m.includes("mkv")) return "mkv";
  if (m.includes("mpeg") || m.includes("mpg")) return "mpeg";
  if (m.includes("flv")) return "flv";
  if (m.includes("wmv")) return "wmv";
  if (m.includes("3gp")) return "3gp";
  return undefined;
}

function docFormatFromMime(mime: string): DocumentFormat {
  const m = mime.toLowerCase();
  if (m.includes("pdf")) return "pdf";
  if (m.includes("csv")) return "csv";
  if (m.includes("wordprocessingml") || m.endsWith("/docx")) return "docx";
  if (m.includes("msword") || m.endsWith("/doc")) return "doc";
  if (m.includes("spreadsheetml") || m.endsWith("/xlsx")) return "xlsx";
  if (m.includes("ms-excel") || m.endsWith("/xls")) return "xls";
  if (m.includes("html")) return "html";
  if (m.includes("markdown") || m.endsWith("/md")) return "md";
  if (m.includes("json")) return "json";
  if (m.includes("xml")) return "xml";
  return "txt";
}

/** Faithful representation of an embedded text resource (preserves its URI). */
function textResourceToStrands(r: TextResourceContents): ContentBlock[] {
  const mime = r.mimeType ? ` (${r.mimeType})` : "";
  return [new TextBlock(`Attached resource ${r.uri}${mime}:\n\n${r.text}`)];
}

/** Route an embedded binary resource to the closest Strands media block. */
function blobResourceToStrands(r: BlobResourceContents): ContentBlock[] {
  const bytes = decodeBase64(r.blob);
  const mime = (r.mimeType ?? "application/octet-stream").toLowerCase();
  if (mime.startsWith("image/")) {
    return [
      new ImageBlock({
        format: imageFormatFromMime(mime),
        source: { bytes },
      }),
    ];
  }
  if (mime.startsWith("video/")) {
    const format = videoFormatFromMime(mime);
    if (format) {
      return [new VideoBlock({ format, source: { bytes } })];
    }
  }
  return [
    new DocumentBlock({
      format: docFormatFromMime(mime),
      name: basename(r.uri),
      source: { bytes },
      context: r.uri,
    }),
  ];
}

/** Text describing a resource link (metadata the agent may act on via tools). */
function resourceLinkText(block: ResourceLink): string {
  const label = block.title?.trim() || block.name;
  const meta: string[] = [];
  if (block.mimeType) meta.push(block.mimeType);
  if (typeof block.size === "number") meta.push(`${block.size} bytes`);
  const suffix = meta.length > 0 ? ` (${meta.join(", ")})` : "";
  const desc = block.description?.trim() ? `\n${block.description.trim()}` : "";
  return `[resource_link ${label}](${block.uri})${suffix}${desc}`;
}

function acpBlockToStrands(block: AcpContentBlock): ContentBlock[] {
  switch (block.type) {
    case "text":
      return [new TextBlock(block.text)];
    case "image": {
      const bytes = decodeBase64(block.data);
      return [
        new ImageBlock({
          format: imageFormatFromMime(block.mimeType),
          source: { bytes },
        }),
      ];
    }
    case "audio": {
      // Strands has no audio content block; surface a descriptive marker so the
      // model is aware of the attachment without receiving unusable bytes.
      const bytes = decodeBase64(block.data);
      return [
        new TextBlock(
          `[audio attachment mimeType=${JSON.stringify(block.mimeType)} bytes=${bytes.byteLength} — not forwarded to the model]`,
        ),
      ];
    }
    case "resource":
      return "text" in block.resource
        ? textResourceToStrands(block.resource)
        : blobResourceToStrands(block.resource);
    case "resource_link":
      return [new TextBlock(resourceLinkText(block))];
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
      case "image":
        lines.push(`[image ${block.mimeType} ${block.data.length} b64 chars]`);
        break;
      case "audio":
        lines.push(`[audio ${block.mimeType} ${block.data.length} b64 chars]`);
        break;
      case "resource":
        if ("text" in block.resource) {
          const mime = block.resource.mimeType
            ? ` (${block.resource.mimeType})`
            : "";
          lines.push(
            `Attached resource ${block.resource.uri}${mime}:\n\n${block.resource.text}`,
          );
        } else {
          lines.push(
            `[binary resource uri=${block.resource.uri} mime=${block.resource.mimeType ?? ""} len=${block.resource.blob.length}]`,
          );
        }
        break;
      case "resource_link":
        lines.push(resourceLinkText(block));
        break;
      default:
        lines.push(JSON.stringify(block));
    }
  }
  return lines.join("\n\n").trim();
}
