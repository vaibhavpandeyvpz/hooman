import { basename } from "node:path";
import {
  DocumentBlock,
  ImageBlock,
  TextBlock,
  VideoBlock,
  type DocumentFormat,
  type ImageFormat,
  type VideoFormat,
} from "@strands-agents/sdk";
import type { BlobResourceContents } from "@agentclientprotocol/sdk";
import type { ResolvedLlmMetadata } from "./metadata.js";
import {
  detectDocumentFormat,
  detectImageFormat,
  detectVideoFormat,
} from "./file-formats.js";

export type LlmInputModality = {
  text?: boolean;
  image?: boolean;
  pdf?: boolean;
  audio?: boolean;
  video?: boolean;
};

export type ResolvedLlmInputModality = {
  text: boolean;
  image: boolean;
  pdf: boolean;
  audio: boolean;
  video: boolean;
};

export type SupportedPromptBlock =
  TextBlock | ImageBlock | VideoBlock | DocumentBlock;

export type BinaryPromptTarget = {
  bytes: Uint8Array;
  label: string;
  mimeType?: string;
  sizeBytes: number;
  path?: string;
  context?: string;
};

const DEFAULT_MODALITY: ResolvedLlmInputModality = {
  text: true,
  image: false,
  pdf: false,
  audio: false,
  video: false,
};

export function resolveInputModality(
  metadata?: Pick<ResolvedLlmMetadata, "modality"> | null,
): ResolvedLlmInputModality {
  return {
    ...DEFAULT_MODALITY,
    ...(metadata?.modality ?? {}),
  };
}

export function imageFormatFromMime(mime: string): ImageFormat {
  const m = mime.toLowerCase();
  if (m.includes("jpeg") || m.includes("jpg")) return "jpeg";
  if (m.includes("gif")) return "gif";
  if (m.includes("webp")) return "webp";
  return "png";
}

export function videoFormatFromMime(mime: string): VideoFormat | undefined {
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

export function documentFormatFromMime(mime: string): DocumentFormat {
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

function fallbackText(
  target: BinaryPromptTarget,
  reason: string,
  kind: string,
): TextBlock {
  const details = [
    `Attached ${kind} not forwarded natively to the model:`,
    `- label: ${target.label}`,
    ...(target.path ? [`- path: ${target.path}`] : []),
    ...(target.context ? [`- context: ${target.context}`] : []),
    ...(target.mimeType ? [`- mime: ${target.mimeType}`] : []),
    `- size_bytes: ${target.sizeBytes}`,
    `- reason: ${reason}`,
    "You can inspect this file using tools if needed.",
  ];
  return new TextBlock(details.join("\n"));
}

export function binaryTargetToPromptBlocks(
  target: BinaryPromptTarget,
  modality?: Pick<ResolvedLlmMetadata, "modality"> | null,
): SupportedPromptBlock[] {
  const resolved = resolveInputModality(modality);
  const mime = (target.mimeType ?? "application/octet-stream").toLowerCase();

  if (mime.startsWith("image/")) {
    if (resolved.image) {
      return [
        new ImageBlock({
          format: imageFormatFromMime(mime),
          source: { bytes: target.bytes },
        }),
      ];
    }
    return [
      fallbackText(
        target,
        "Current model does not support image input.",
        "image",
      ),
    ];
  }

  if (mime === "application/pdf") {
    if (resolved.pdf) {
      return [
        new DocumentBlock({
          format: "pdf",
          name: target.label,
          source: { bytes: target.bytes },
          ...(target.context ? { context: target.context } : {}),
        }),
      ];
    }
    return [
      fallbackText(target, "Current model does not support PDF input.", "pdf"),
    ];
  }

  if (mime.startsWith("video/")) {
    const format = videoFormatFromMime(mime);
    if (resolved.video && format) {
      return [new VideoBlock({ format, source: { bytes: target.bytes } })];
    }
    return [
      fallbackText(
        target,
        "Current model does not support video input.",
        "video",
      ),
    ];
  }

  if (mime.startsWith("audio/")) {
    return [
      fallbackText(
        target,
        resolved.audio
          ? "Audio input is not supported by the current Strands block mapping."
          : "Current model does not support audio input.",
        "audio",
      ),
    ];
  }

  return [
    fallbackText(
      target,
      "Unsupported binary type for native prompt forwarding.",
      "file",
    ),
  ];
}

export function attachmentPathToPromptBlocks(args: {
  path: string;
  bytes: Uint8Array;
  sizeBytes: number;
  metadata?: Pick<ResolvedLlmMetadata, "modality"> | null;
  includeMetadata?: boolean;
}): SupportedPromptBlock[] {
  const { path, bytes, sizeBytes, metadata, includeMetadata = true } = args;
  const imageFormat = detectImageFormat(path);
  if (imageFormat) {
    const blocks = binaryTargetToPromptBlocks(
      {
        bytes,
        label: basename(path),
        path,
        sizeBytes,
        mimeType: `image/${imageFormat === "jpeg" ? "jpeg" : imageFormat}`,
      },
      metadata,
    );
    return includeMetadata
      ? [
          new TextBlock(
            JSON.stringify({
              path,
              kind: "image",
              format: imageFormat,
              size_bytes: sizeBytes,
            }),
          ),
          ...blocks,
        ]
      : blocks;
  }

  const videoFormat = detectVideoFormat(path);
  if (videoFormat) {
    const blocks = binaryTargetToPromptBlocks(
      {
        bytes,
        label: basename(path),
        path,
        sizeBytes,
        mimeType: `video/${videoFormat === "mov" ? "quicktime" : videoFormat}`,
      },
      metadata,
    );
    return includeMetadata
      ? [
          new TextBlock(
            JSON.stringify({
              path,
              kind: "video",
              format: videoFormat,
              size_bytes: sizeBytes,
            }),
          ),
          ...blocks,
        ]
      : blocks;
  }

  const documentFormat = detectDocumentFormat(path);
  if (documentFormat) {
    const mimeType =
      documentFormat === "pdf"
        ? "application/pdf"
        : `application/${documentFormat}`;
    const blocks = binaryTargetToPromptBlocks(
      {
        bytes,
        label: basename(path),
        path,
        sizeBytes,
        mimeType,
      },
      metadata,
    );
    return includeMetadata
      ? [
          new TextBlock(
            JSON.stringify({
              path,
              kind: "document",
              format: documentFormat,
              size_bytes: sizeBytes,
            }),
          ),
          ...blocks,
        ]
      : blocks;
  }

  return [
    fallbackText(
      {
        bytes,
        label: basename(path),
        path,
        sizeBytes,
      },
      "Unsupported attachment format.",
      "file",
    ),
  ];
}

export function blobResourceToPromptBlocks(
  resource: BlobResourceContents,
  metadata?: Pick<ResolvedLlmMetadata, "modality"> | null,
): SupportedPromptBlock[] {
  const bytes = new Uint8Array(Buffer.from(resource.blob, "base64"));
  return binaryTargetToPromptBlocks(
    {
      bytes,
      label: basename(resource.uri),
      ...(resource.mimeType ? { mimeType: resource.mimeType } : {}),
      sizeBytes: bytes.byteLength,
      context: resource.uri,
    },
    metadata,
  );
}
