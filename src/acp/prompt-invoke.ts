import type {
  ContentBlock as AcpContentBlock,
  BlobResourceContents,
  ResourceLink,
  TextResourceContents,
} from "@agentclientprotocol/sdk";
import { Agent as StrandsAgent, Message, TextBlock } from "@strands-agents/sdk";
import type { ContentBlock } from "@strands-agents/sdk";
import type { ResolvedLlmMetadata } from "../core/utils/metadata.js";
import {
  blobResourceToPromptBlocks,
  binaryTargetToPromptBlocks,
  imageFormatFromMime,
} from "../core/utils/model-metadata.js";

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

/** Faithful representation of an embedded text resource (preserves its URI). */
function textResourceToStrands(r: TextResourceContents): ContentBlock[] {
  const mime = r.mimeType ? ` (${r.mimeType})` : "";
  return [new TextBlock(`Attached resource ${r.uri}${mime}:\n\n${r.text}`)];
}

/** Route an embedded binary resource to the closest Strands media block. */
function blobResourceToStrands(
  r: BlobResourceContents,
  metadata?: Pick<ResolvedLlmMetadata, "modality"> | null,
): ContentBlock[] {
  return blobResourceToPromptBlocks(r, metadata);
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

function acpBlockToStrands(
  block: AcpContentBlock,
  metadata?: Pick<ResolvedLlmMetadata, "modality"> | null,
): ContentBlock[] {
  switch (block.type) {
    case "text":
      return [new TextBlock(block.text)];
    case "image": {
      const bytes = decodeBase64(block.data);
      return binaryTargetToPromptBlocks(
        {
          bytes,
          label: `image.${imageFormatFromMime(block.mimeType)}`,
          mimeType: block.mimeType,
          sizeBytes: bytes.byteLength,
        },
        metadata,
      );
    }
    case "audio": {
      const bytes = decodeBase64(block.data);
      return binaryTargetToPromptBlocks(
        {
          bytes,
          label: basename(
            `attachment.${block.mimeType.split("/").pop() ?? "audio"}`,
          ),
          mimeType: block.mimeType,
          sizeBytes: bytes.byteLength,
        },
        metadata,
      );
    }
    case "resource":
      return "text" in block.resource
        ? textResourceToStrands(block.resource)
        : blobResourceToStrands(block.resource, metadata);
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
  metadata?: Pick<ResolvedLlmMetadata, "modality"> | null,
): AgentStreamInput {
  const parts: ContentBlock[] = [];
  for (const block of prompt) {
    parts.push(...acpBlockToStrands(block, metadata));
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
