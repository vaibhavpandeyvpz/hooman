import { readFile, stat } from "node:fs/promises";
import { TextBlock, type ContentBlock } from "@strands-agents/sdk";
import type { ResolvedLlmMetadata } from "./metadata.js";
import { attachmentPathToPromptBlocks } from "./model-metadata.js";

const DEFAULT_MAX_ATTACHMENT_BYTES = 1024 * 1024;

export type AttachmentBinaryFallback = {
  path: string;
  encoding: "base64";
  content: string;
  sizeBytes: number;
};

export type AttachmentMediaBlocks = Array<ContentBlock>;

export type AttachmentReadResult =
  AttachmentMediaBlocks | AttachmentBinaryFallback;

type AttachmentReadOptions = {
  maxBytes?: number;
  includeMetadata?: boolean;
  unsupportedFormat?: "diagnostic" | "base64";
  onError?: "throw" | "diagnostic";
  diagnosticKind?: string;
  metadata?: Pick<ResolvedLlmMetadata, "modality"> | null;
};

export function normalizeAttachmentPaths(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const normalized = input
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
  return [...new Set(normalized)];
}

export function attachmentDiagnosticBlock(
  path: string,
  reason: string,
  extra?: Record<string, unknown>,
  kind = "attachment",
): TextBlock {
  return new TextBlock(
    JSON.stringify({
      path,
      kind,
      skipped: true,
      reason,
      ...(extra ?? {}),
    }),
  );
}

export async function readAttachmentAsBlocksOrBase64(
  filePath: string,
  options?: AttachmentReadOptions,
): Promise<AttachmentReadResult> {
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_ATTACHMENT_BYTES;
  const includeMetadata = options?.includeMetadata ?? true;
  const unsupportedFormat = options?.unsupportedFormat ?? "base64";
  const onError = options?.onError ?? "throw";
  const diagnosticKind = options?.diagnosticKind ?? "attachment";
  const trimmedPath = filePath.trim();

  const asDiagnostic = (
    reason: string,
    extra?: Record<string, unknown>,
  ): AttachmentMediaBlocks => [
    attachmentDiagnosticBlock(trimmedPath, reason, extra, diagnosticKind),
  ];

  if (!trimmedPath) {
    if (onError === "diagnostic") {
      return asDiagnostic("Attachment path is empty.");
    }
    throw new Error("Attachment path is empty.");
  }

  try {
    const info = await stat(trimmedPath);
    if (!info.isFile()) {
      if (onError === "diagnostic") {
        return asDiagnostic("Attachment path is not a file.");
      }
      throw new Error(`Path is not a file: ${trimmedPath}`);
    }

    if (info.size > maxBytes) {
      if (onError === "diagnostic") {
        return asDiagnostic("Attachment exceeds size limit.", {
          size_bytes: info.size,
          max_size_bytes: maxBytes,
        });
      }
      throw new Error(
        `File too large to read safely (${info.size} bytes). Use a different path or process the file with another tool.`,
      );
    }

    const buffer = await readFile(trimmedPath);
    const bytes = new Uint8Array(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength,
    );
    const blocks = attachmentPathToPromptBlocks({
      path: trimmedPath,
      bytes,
      sizeBytes: info.size,
      metadata: options?.metadata,
      includeMetadata,
    });

    if (blocks.length > 0) {
      return blocks;
    }

    if (unsupportedFormat === "diagnostic") {
      return asDiagnostic("Unsupported attachment format.", {
        size_bytes: info.size,
      });
    }

    return {
      path: trimmedPath,
      encoding: "base64",
      content: buffer.toString("base64"),
      sizeBytes: buffer.length,
    };
  } catch (error) {
    if (onError === "diagnostic") {
      return asDiagnostic("Failed to load attachment.", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
}

export async function attachmentPathsToPromptBlocks(
  paths: readonly string[],
  options?: Omit<AttachmentReadOptions, "unsupportedFormat" | "onError"> & {
    maxBytes?: number;
  },
): Promise<ContentBlock[]> {
  const blocks: ContentBlock[] = [];
  for (const path of paths) {
    const result = await readAttachmentAsBlocksOrBase64(path, {
      ...options,
      unsupportedFormat: "diagnostic",
      onError: "diagnostic",
    });
    if (Array.isArray(result)) {
      blocks.push(...result);
    }
  }
  return blocks;
}
