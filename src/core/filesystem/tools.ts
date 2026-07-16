import {
  applyFileEdit,
  applyFileEdits,
  type FileEdit,
  getFsBackend,
} from "./index.js";
import fs from "node:fs/promises";
import path from "node:path";
import {
  tool,
  TextBlock,
  type ContentBlock,
  type JSONValue,
  type ToolContext,
} from "@strands-agents/sdk";
import { normalizeUserPath } from "../utils/normalize-user-path.js";
import { resolveAgentInstructionsForFile } from "../prompts/runtime/agents.js";
import {
  readAttachmentAsBlocksOrBase64,
  type AttachmentMediaBlocks,
} from "../utils/attachments.js";
import { getLlmModality } from "../state/llm-modality.js";
import type { ResolvedLlmMetadata } from "../utils/metadata.js";
import { z } from "zod";
import { createGitignorePredicate } from "../utils/gitignore.js";

/**
 * Optional per-agent text filesystem backend.
 *
 * When an embedding host (e.g. an ACP client that advertises the `fs`
 * capability) can read/write text files on the agent's behalf, it registers a
 * backend here. The built-in filesystem tools then route text reads and writes
 * through it so the agent sees unsaved editor state and the host can track
 * modifications. When no backend is registered, the tools use local disk I/O.
 */
export type TextFsReadOptions = {
  /** 1-based line to start reading from. */
  line?: number;
  /** Maximum number of lines to read. */
  limit?: number;
};

export type TextFsBackend = {
  /** Whether the host can service text reads (`fs/read_text_file`). */
  canRead: boolean;
  /** Whether the host can service text writes (`fs/write_text_file`). */
  canWrite: boolean;
  readTextFile(path: string, options?: TextFsReadOptions): Promise<string>;
  writeTextFile(path: string, content: string): Promise<void>;
};

/** Keyed by the Strands agent instance so backends are never serialized. */
const textFsBackends = new WeakMap<object, TextFsBackend>();

export function setTextFsBackend(agent: object, backend: TextFsBackend): void {
  textFsBackends.set(agent, backend);
}

export function getTextFsBackend(
  agent: object | undefined,
): TextFsBackend | undefined {
  return agent ? textFsBackends.get(agent) : undefined;
}

const DEFAULT_READ_LIMIT = 250;
const DEFAULT_MAX_READ_BYTES = 1024 * 1024;
const DEFAULT_TREE_DEPTH = 4;
const FAST_READ_MAX_BYTES = 10 * 1024 * 1024;
const STREAM_HIGH_WATER_MARK = 512 * 1024;
const runtimeResolvedAgentInstructionPaths = new WeakMap<object, Set<string>>();

type ReadTimeAgentInstructions = {
  loaded_paths: string[];
  content: string;
};

const FileEditSchema = z.discriminatedUnion("mode", [
  z
    .object({
      path: z.string(),
      mode: z.literal("write"),
      content: z.string(),
      expected_sha256: z.string().optional(),
    })
    .strict(),
  z
    .object({
      path: z.string(),
      mode: z.literal("replace"),
      old_text: z
        .string()
        .min(1)
        .describe("Small, unique text block to replace."),
      new_text: z.string().describe("Replacement text."),
      replace_all: z
        .boolean()
        .optional()
        .describe(
          "Replace every exact occurrence. A tolerant fallback replaces one unique match.",
        ),
      expected_sha256: z.string().optional(),
    })
    .strict(),
  z
    .object({
      path: z.string(),
      mode: z.literal("edit"),
      content: z.string(),
      insert_at: z.number().int().min(1).describe("1-based first line."),
      replace_until: z
        .number()
        .int()
        .min(1)
        .nullable()
        .optional()
        .describe(
          "Inclusive last line to replace. Omit to insert before insert_at.",
        ),
      expected_sha256: z.string().optional(),
    })
    .strict(),
  z
    .object({
      path: z.string(),
      mode: z.literal("rename"),
      new_path: z.string(),
      expected_sha256: z.string().optional(),
    })
    .strict(),
  z
    .object({
      path: z.string(),
      mode: z.literal("delete"),
      expected_sha256: z.string().optional(),
    })
    .strict(),
]);

type TreeNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: TreeNode[];
};

type TextReadState = {
  content: string;
  mtimeMs: number;
  offset: number;
  limit?: number;
  isPartial: boolean;
};

const textReadState = new Map<string, TextReadState>();

function toJsonValue(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

/**
 * Render a text read as plain text (returned to the model as a text block,
 * not JSON). A bracketed status line is prepended only for partial reads,
 * and file-scoped AGENTS.md instructions are appended as a bracketed trailer.
 */
function formatReadResult(
  result: {
    path: string;
    content: string;
    startLine: number;
    endLine: number;
    totalLines: number;
    truncated: boolean;
  },
  agentsInstructions?: ReadTimeAgentInstructions,
): string {
  const parts: string[] = [];
  const partial =
    result.truncated ||
    result.startLine > 1 ||
    result.endLine < result.totalLines;
  if (partial) {
    parts.push(
      `[Showing lines ${result.startLine}-${result.endLine} of ${result.totalLines}. Call read_file again with offset/limit for more.]`,
    );
  }
  parts.push(result.content.length > 0 ? result.content : "[File is empty]");
  if (agentsInstructions) {
    parts.push(
      `[AGENTS.md instructions for this file, from: ${agentsInstructions.loaded_paths.join(", ")}]\n${agentsInstructions.content}`,
    );
  }
  return parts.join("\n\n");
}

export function clearReadTimeAgentInstructionState(agent: object): void {
  runtimeResolvedAgentInstructionPaths.delete(agent);
}

function resolveReadTimeAgentInstructions(
  filePath: string,
  context?: ToolContext,
): ReadTimeAgentInstructions | undefined {
  if (!context) {
    return undefined;
  }
  const loadedPaths =
    runtimeResolvedAgentInstructionPaths.get(context.agent) ??
    new Set<string>();
  const resolved = resolveAgentInstructionsForFile(filePath, {
    excludePaths: [...loadedPaths],
  });
  if (resolved.paths.length === 0 || resolved.content.length === 0) {
    return undefined;
  }
  for (const instructionPath of resolved.paths) {
    loadedPaths.add(instructionPath);
  }
  runtimeResolvedAgentInstructionPaths.set(context.agent, loadedPaths);
  return {
    loaded_paths: resolved.paths,
    content: resolved.content,
  };
}

function normalizeForGlob(inputPath: string): string {
  return inputPath.replace(/\\/g, "/");
}

function globToRegExp(pattern: string): RegExp {
  const normalized = normalizeForGlob(pattern);
  let regex = "^";

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i]!;
    const next = normalized[i + 1];

    if (char === "*" && next === "*") {
      regex += ".*";
      i += 1;
      continue;
    }

    if (char === "*") {
      regex += "[^/]*";
      continue;
    }

    if (char === "?") {
      regex += "[^/]";
      continue;
    }

    regex += /[\\^$+?.()|[\]{}]/.test(char) ? `\\${char}` : char;
  }

  regex += "$";
  return new RegExp(regex, "i");
}

function splitLines(content: string): string[] {
  return content.split(/\r?\n/);
}

function makeLineExcerpt(
  content: string,
  offset = 1,
  limit = DEFAULT_READ_LIMIT,
): {
  content: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
} {
  const lines = splitLines(content);
  const totalLines = lines.length;
  const startIndex = Math.max(0, offset - 1);
  const selected = lines.slice(startIndex, startIndex + limit);
  const hasSelection = selected.length > 0;
  const emptyBoundary = Math.min(Math.max(1, offset), totalLines);

  return {
    content: selected.join("\n"),
    startLine: hasSelection ? startIndex + 1 : emptyBoundary,
    endLine: hasSelection ? startIndex + selected.length : emptyBoundary,
    totalLines,
    truncated: startIndex + selected.length < totalLines,
  };
}

function isProbablyBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) {
    return false;
  }

  let suspicious = 0;
  const sample = Math.min(buffer.length, 8000);

  for (let i = 0; i < sample; i += 1) {
    const byte = buffer[i]!;

    if (byte === 0) {
      return true;
    }

    const isTextByte =
      byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126);

    if (!isTextByte) {
      suspicious += 1;
    }
  }

  return suspicious / sample > 0.3;
}

async function ensureExists(filePath: string): Promise<void> {
  await fs.access(filePath);
}

async function ensureDirectory(filePath: string): Promise<void> {
  const stat = await fs.stat(filePath);
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${filePath}`);
  }
}

async function statFile(
  filePath: string,
): Promise<Awaited<ReturnType<typeof fs.stat>>> {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    throw new Error(`Path is not a file: ${filePath}`);
  }

  return stat;
}

async function readTextFile(
  filePath: string,
  options?: { offset?: number; limit?: number; maxBytes?: number },
  backend?: TextFsBackend,
): Promise<{
  path: string;
  content: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
  sizeBytes: number;
}> {
  if (backend?.canRead) {
    // Host owns the file contents (including unsaved editor state). Fetch the
    // whole file and reuse the local windowing/metadata logic for a consistent
    // result shape.
    const whole = await backend.readTextFile(filePath);
    const offset = options?.offset ?? 1;
    const excerpt = makeLineExcerpt(whole, options?.offset, options?.limit);
    textReadState.set(filePath, {
      content: excerpt.content,
      mtimeMs: 0,
      offset,
      limit: options?.limit,
      isPartial:
        excerpt.startLine !== 1 || excerpt.endLine < excerpt.totalLines,
    });
    return {
      path: filePath,
      content: excerpt.content,
      startLine: excerpt.startLine,
      endLine: excerpt.endLine,
      totalLines: excerpt.totalLines,
      truncated: excerpt.truncated,
      sizeBytes: Buffer.byteLength(whole, "utf8"),
    };
  }

  const stat = await statFile(filePath);
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_READ_BYTES;
  const offset = options?.offset ?? 1;

  if (stat.size > maxBytes && options?.limit === undefined) {
    throw new Error(
      `File too large to read safely (${stat.size} bytes). Use a narrower read or another tool.`,
    );
  }

  const readResult =
    stat.size < FAST_READ_MAX_BYTES
      ? await readTextFileFast(filePath, options)
      : await readTextFileStreaming(filePath, options);

  textReadState.set(filePath, {
    content: readResult.content,
    mtimeMs: Number(stat.mtimeMs),
    offset,
    limit: options?.limit,
    isPartial:
      readResult.startLine !== 1 || readResult.endLine < readResult.totalLines,
  });

  return {
    path: filePath,
    content: readResult.content,
    startLine: readResult.startLine,
    endLine: readResult.endLine,
    totalLines: readResult.totalLines,
    truncated: readResult.truncated,
    sizeBytes: Number(stat.size),
  };
}

async function readTextFileFast(
  filePath: string,
  options?: { offset?: number; limit?: number },
): Promise<{
  content: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
}> {
  const buffer = await fs.readFile(filePath);
  assertTextBuffer(buffer);

  return makeLineExcerpt(
    buffer.toString("utf8"),
    options?.offset,
    options?.limit,
  );
}

async function readTextFileStreaming(
  filePath: string,
  options?: { offset?: number; limit?: number },
): Promise<{
  content: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
}> {
  const offset = options?.offset ?? 1;
  const limit = options?.limit ?? DEFAULT_READ_LIMIT;
  const startIndex = Math.max(0, offset - 1);
  const endIndex = startIndex + limit;
  const selectedLines: string[] = [];
  const handle = await fs.open(filePath, "r");
  const buffer = Buffer.allocUnsafe(STREAM_HIGH_WATER_MARK);
  let position = 0;
  let lineIndex = 0;
  let partial = "";
  let sampledBytes = 0;
  let sample = Buffer.alloc(0);

  try {
    for (;;) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        buffer.length,
        position,
      );

      if (bytesRead === 0) {
        break;
      }

      if (sampledBytes < 8000) {
        const remaining = 8000 - sampledBytes;
        const nextSample = buffer.subarray(0, Math.min(bytesRead, remaining));
        sample = Buffer.concat([sample, nextSample]);
        sampledBytes += nextSample.length;
        assertTextBuffer(sample);
      }

      position += bytesRead;
      const data = partial + buffer.toString("utf8", 0, bytesRead);
      const lines = data.split("\n");
      partial = lines.pop() ?? "";

      for (const rawLine of lines) {
        if (lineIndex >= startIndex && lineIndex < endIndex) {
          selectedLines.push(
            rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine,
          );
        }
        lineIndex += 1;
      }
    }

    if (partial.length > 0 || position > 0) {
      if (lineIndex >= startIndex && lineIndex < endIndex) {
        selectedLines.push(
          partial.endsWith("\r") ? partial.slice(0, -1) : partial,
        );
      }
      lineIndex += 1;
    }
  } finally {
    await handle.close();
  }

  return {
    content: selectedLines.join("\n"),
    startLine: selectedLines.length > 0 ? startIndex + 1 : offset,
    endLine:
      selectedLines.length > 0 ? startIndex + selectedLines.length : offset - 1,
    totalLines: lineIndex,
    truncated: endIndex < lineIndex,
  };
}

function assertTextBuffer(buffer: Buffer): void {
  if (isProbablyBinary(buffer)) {
    throw new Error(
      "File appears to be binary. Call read_file again with `binary: true` — images (png/jpeg/gif/webp), videos (mp4/mov/mkv/webm/etc.), and documents (pdf/docx/csv/etc.) are returned as multimodal content blocks the provider can forward to the model; unknown binary types come back as base64.",
    );
  }
}

type BinaryReadResult =
  | AttachmentMediaBlocks
  | {
      path: string;
      encoding: "base64";
      content: string;
      sizeBytes: number;
    };

async function readBinaryFile(
  filePath: string,
  options?: {
    maxBytes?: number;
    modality?: Pick<ResolvedLlmMetadata, "modality"> | null;
  },
): Promise<BinaryReadResult> {
  return readAttachmentAsBlocksOrBase64(filePath, {
    maxBytes: options?.maxBytes ?? DEFAULT_MAX_READ_BYTES,
    includeMetadata: true,
    unsupportedFormat: "base64",
    onError: "throw",
    metadata: options?.modality ?? null,
  });
}

async function walkDirectory(
  dirPath: string,
  options?: {
    recursive?: boolean;
    maxDepth?: number;
    excludePatterns?: string[];
  },
): Promise<Array<{ path: string; type: "file" | "directory"; size?: number }>> {
  const results: Array<{
    path: string;
    type: "file" | "directory";
    size?: number;
  }> = [];
  const recursive = options?.recursive ?? false;
  const maxDepth = options?.maxDepth ?? DEFAULT_TREE_DEPTH;
  const excludes = (options?.excludePatterns ?? []).map(globToRegExp);
  const gitignore = await createGitignorePredicate(dirPath);

  async function visit(currentPath: string, depth: number): Promise<void> {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      const relative = normalizeForGlob(
        path.relative(dirPath, fullPath) || entry.name,
      );

      if (excludes.some((pattern) => pattern.test(relative))) {
        continue;
      }

      if (
        gitignore.ignoresPath(fullPath, { isDirectory: entry.isDirectory() })
      ) {
        continue;
      }

      if (entry.isDirectory()) {
        results.push({ path: fullPath, type: "directory" });

        if (recursive && depth < maxDepth) {
          await visit(fullPath, depth + 1);
        }
      } else if (entry.isFile()) {
        const stat = await fs.stat(fullPath);
        results.push({ path: fullPath, type: "file", size: stat.size });
      }
    }
  }

  await visit(dirPath, 1);
  return results;
}

async function buildTree(
  rootPath: string,
  options?: { maxDepth?: number; excludePatterns?: string[] },
): Promise<TreeNode> {
  const excludes = (options?.excludePatterns ?? []).map(globToRegExp);
  const maxDepth = options?.maxDepth ?? DEFAULT_TREE_DEPTH;
  const gitignore = await createGitignorePredicate(rootPath);

  async function build(currentPath: string, depth: number): Promise<TreeNode> {
    const stat = await fs.stat(currentPath);
    const node: TreeNode = {
      name: path.basename(currentPath) || currentPath,
      path: currentPath,
      type: stat.isDirectory() ? "directory" : "file",
    };

    if (!stat.isDirectory() || depth >= maxDepth) {
      return node;
    }

    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    const children: TreeNode[] = [];

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      const relative = normalizeForGlob(
        path.relative(rootPath, fullPath) || entry.name,
      );

      if (excludes.some((pattern) => pattern.test(relative))) {
        continue;
      }

      if (
        gitignore.ignoresPath(fullPath, { isDirectory: entry.isDirectory() })
      ) {
        continue;
      }

      children.push(await build(fullPath, depth + 1));
    }

    node.children = children;
    return node;
  }

  return build(rootPath, 1);
}

function createFilesystemSchema() {
  return {
    readFile: z.object({
      path: z.string().describe("File path to read."),
      offset: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("1-indexed starting line."),
      limit: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Maximum number of lines to read."),
      binary: z
        .boolean()
        .optional()
        .describe(
          "Read as binary. Images, videos, and documents are returned as multimodal content blocks (forwarded to the active provider's native media format where supported); other binary files come back as base64.",
        ),
    }),
    readMultipleFiles: z.object({
      paths: z.array(z.string()).min(1).describe("List of file paths to read."),
      offset: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).optional(),
      binary: z
        .boolean()
        .optional()
        .describe(
          "Read each path as binary. Images, videos, and documents become multimodal content blocks (when the model supports them); other binaries come back as base64. Offset/limit are ignored when binary is true.",
        ),
    }),
    editFile: FileEditSchema,
    editMultipleFiles: z.object({
      edits: z.array(FileEditSchema).min(1).max(100),
    }),
    createDirectory: z.object({
      path: z.string().describe("Directory path to create."),
      recursive: z
        .boolean()
        .optional()
        .describe("Create parent directories too."),
    }),
    listDirectory: z.object({
      path: z.string().describe("Directory path to list."),
      recursive: z.boolean().optional().describe("List recursively."),
      max_depth: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Maximum recursion depth."),
      exclude_patterns: z
        .array(z.string())
        .optional()
        .describe("Glob-style exclude patterns."),
    }),
    directoryTree: z.object({
      path: z.string().describe("Directory path to render as a tree."),
      max_depth: z.number().int().min(1).optional(),
      exclude_patterns: z.array(z.string()).optional(),
    }),
    moveFile: z.object({
      source: z.string().describe("Source file or directory."),
      destination: z.string().describe("Destination path."),
      overwrite: z
        .boolean()
        .optional()
        .describe("Overwrite destination if it exists."),
    }),
    getFileInfo: z.object({
      path: z.string().describe("File or directory path."),
    }),
  };
}

export function createFilesystemTools() {
  const schema = createFilesystemSchema();

  return [
    tool({
      name: "read_file",
      description:
        "Read a file. Defaults to UTF-8 text with optional line offset/limit. Pass `binary: true` for non-text files: images (jpeg/png/gif/webp), videos (mp4/mov/mkv/webm/etc.), and documents (pdf/docx/csv/etc.) are returned as multimodal content blocks — the active model provider forwards them natively where supported (Bedrock for all; Anthropic for images + docs; Google for images + docs; OpenAI for images; Ollama for images) and logs a warning for unsupported kinds. Any other binary file is returned as base64.",
      inputSchema: schema.readFile,
      callback: async (input, context?: ToolContext) => {
        const filePath = normalizeUserPath(input.path);

        if (input.binary) {
          // Binary reads can return SDK media blocks (ImageBlock / DocumentBlock)
          // or a plain base64 JSON object. Both are accepted by FunctionTool's
          // result wrapping, but the callback signature is JSONValue, so cast.
          // Pass the active LLM modality so images become ImageBlocks when the
          // model supports them (otherwise we emit a text fallback diagnostic).
          const modality = getLlmModality(context?.agent);
          const result = await readBinaryFile(filePath, {
            modality: modality ? { modality } : null,
          });
          return result as unknown as JSONValue;
        }

        const result = await readTextFile(
          filePath,
          {
            offset: input.offset,
            limit: input.limit,
          },
          getTextFsBackend(context?.agent),
        );
        const agentsInstructions = resolveReadTimeAgentInstructions(
          filePath,
          context,
        );
        // Return plain text, not JSON: JSON-wrapping the content re-escapes
        // quotes/newlines in the transcript, which nudges models into
        // producing escaped edit targets that no longer match the file.
        return formatReadResult(result, agentsInstructions);
      },
    }),
    tool({
      name: "read_multiple_files",
      description:
        "Read multiple files in one call. Defaults to UTF-8 text with optional shared offset/limit. Pass `binary: true` to read each path as binary/multimodal (images, videos, documents) the same way as read_file.",
      inputSchema: schema.readMultipleFiles,
      callback: async (input, context?: ToolContext) => {
        if (input.binary) {
          const modality = getLlmModality(context?.agent);
          const blocks: ContentBlock[] = [];
          for (const itemPath of input.paths) {
            const filePath = normalizeUserPath(itemPath);
            blocks.push(new TextBlock(`==> ${filePath} <==`));
            try {
              const result = await readBinaryFile(filePath, {
                modality: modality ? { modality } : null,
              });
              if (Array.isArray(result)) {
                blocks.push(...result);
              } else {
                blocks.push(new TextBlock(JSON.stringify(result)));
              }
            } catch (error) {
              blocks.push(
                new TextBlock(
                  `[Error: ${error instanceof Error ? error.message : String(error)}]`,
                ),
              );
            }
          }
          return blocks as unknown as JSONValue;
        }

        const backend = getTextFsBackend(context?.agent);
        const sections = await Promise.all(
          input.paths.map(async (itemPath) => {
            const filePath = normalizeUserPath(itemPath);
            try {
              const readResult = await readTextFile(
                filePath,
                {
                  offset: input.offset,
                  limit: input.limit,
                },
                backend,
              );
              const agentsInstructions = resolveReadTimeAgentInstructions(
                filePath,
                context,
              );
              return `==> ${filePath} <==\n${formatReadResult(readResult, agentsInstructions)}`;
            } catch (error) {
              return `==> ${filePath} <==\n[Error: ${error instanceof Error ? error.message : String(error)}]`;
            }
          }),
        );

        // Plain text (head/tail-style per-file headers) for the same reason
        // as read_file: avoid JSON-escaping file content in the transcript.
        return sections.join("\n\n");
      },
    }),
    tool({
      name: "edit_file",
      description:
        "Create, overwrite, replace text, edit line ranges, rename, or delete one file. Prefer mode 'replace' with a small unique old_text/new_text block for existing text; use mode 'edit' when exact line positions are more convenient.",
      callback: async (input, context?: ToolContext) => {
        const edit = input as FileEdit;
        const normalized: FileEdit = {
          ...edit,
          path: normalizeUserPath(edit.path),
          ...(edit.mode === "rename"
            ? { new_path: normalizeUserPath(edit.new_path) }
            : {}),
        } as FileEdit;
        const result = await applyFileEdit(
          getFsBackend(context?.agent),
          normalized,
        );
        return toJsonValue(result);
      },
    }),
    tool({
      name: "edit_multiple_files",
      description:
        "Apply ordered create, overwrite, text-replacement, line-range edit, rename, or delete operations. Operations run sequentially and may target the same file.",
      inputSchema: schema.editMultipleFiles,
      callback: async (input, context?: ToolContext) => {
        const edits = input.edits.map((edit) => ({
          ...edit,
          path: normalizeUserPath(edit.path),
          ...(edit.mode === "rename"
            ? { new_path: normalizeUserPath(edit.new_path) }
            : {}),
        })) as FileEdit[];
        const results = await applyFileEdits(
          getFsBackend(context?.agent),
          edits,
        );
        return toJsonValue({ edits: results, count: results.length });
      },
    }),
    tool({
      name: "create_directory",
      description:
        "Create a directory, optionally including missing parent directories.",
      inputSchema: schema.createDirectory,
      callback: async (input) => {
        const dirPath = normalizeUserPath(input.path);
        await fs.mkdir(dirPath, { recursive: input.recursive ?? true });

        return toJsonValue({
          path: dirPath,
          recursive: input.recursive ?? true,
        });
      },
    }),
    tool({
      name: "list_directory",
      description:
        "List files and directories at a path, optionally recursively with depth and exclude patterns.",
      inputSchema: schema.listDirectory,
      callback: async (input) => {
        const dirPath = normalizeUserPath(input.path);
        await ensureExists(dirPath);
        await ensureDirectory(dirPath);

        const entries = await walkDirectory(dirPath, {
          recursive: input.recursive,
          maxDepth: input.max_depth,
          excludePatterns: input.exclude_patterns,
        });

        return toJsonValue({
          path: dirPath,
          count: entries.length,
          entries,
        });
      },
    }),
    tool({
      name: "directory_tree",
      description:
        "Return a recursive JSON tree of a directory, with optional depth and exclude patterns.",
      inputSchema: schema.directoryTree,
      callback: async (input) => {
        const dirPath = normalizeUserPath(input.path);
        await ensureExists(dirPath);
        await ensureDirectory(dirPath);

        return toJsonValue(
          await buildTree(dirPath, {
            maxDepth: input.max_depth,
            excludePatterns: input.exclude_patterns,
          }),
        );
      },
    }),
    tool({
      name: "move_file",
      description:
        "Move or rename a file or directory. Can overwrite the destination if explicitly enabled.",
      inputSchema: schema.moveFile,
      callback: async (input) => {
        const source = normalizeUserPath(input.source);
        const destination = normalizeUserPath(input.destination);
        await ensureExists(source);

        if (input.overwrite) {
          await fs.rm(destination, { recursive: true, force: true });
        }

        await fs.mkdir(path.dirname(destination), { recursive: true });
        await fs.rename(source, destination);

        return toJsonValue({
          source,
          destination,
          overwritten: input.overwrite ?? false,
        });
      },
    }),
    tool({
      name: "get_file_info",
      description:
        "Get metadata for a file or directory, including timestamps, size, type, and permissions.",
      inputSchema: schema.getFileInfo,
      callback: async (input) => {
        const filePath = normalizeUserPath(input.path);
        const stat = await fs.stat(filePath);

        return toJsonValue({
          path: filePath,
          name: path.basename(filePath),
          size_bytes: stat.size,
          created_at: stat.birthtime.toISOString(),
          modified_at: stat.mtime.toISOString(),
          accessed_at: stat.atime.toISOString(),
          is_file: stat.isFile(),
          is_directory: stat.isDirectory(),
          permissions_octal: stat.mode.toString(8).slice(-3),
        });
      },
    }),
  ];
}
