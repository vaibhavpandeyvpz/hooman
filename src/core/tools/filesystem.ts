import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { tool, type JSONValue, type ToolContext } from "@strands-agents/sdk";
import { normalizeUserPath } from "../utils/normalize-user-path.js";
import {
  setFileToolDisplay,
  type StructuredPatchHunk,
} from "../state/file-tool-display.js";
import {
  readAttachmentAsBlocksOrBase64,
  type AttachmentMediaBlocks,
} from "../utils/attachments.js";
import { z } from "zod";

const DEFAULT_READ_LIMIT = 250;
const DEFAULT_MAX_READ_BYTES = 1024 * 1024;
const DEFAULT_SEARCH_MAX_RESULTS = 500;
const DEFAULT_TREE_DEPTH = 4;
const SNIPPET_RADIUS = 3;
const FAST_READ_MAX_BYTES = 10 * 1024 * 1024;
const STREAM_HIGH_WATER_MARK = 512 * 1024;

const EditSchema = z.object({
  oldText: z
    .string()
    .min(1)
    .describe("Exact text to find. Must match uniquely."),
  newText: z.string().describe("Replacement text."),
});

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

function normalizeLineEndings(content: string): string {
  return content.replaceAll("\r\n", "\n");
}

function detectLineEndings(content: string): "CRLF" | "LF" {
  return content.includes("\r\n") ? "CRLF" : "LF";
}

function restoreLineEndings(
  content: string,
  lineEndings: "CRLF" | "LF",
): string {
  if (lineEndings === "LF") {
    return content;
  }

  return normalizeLineEndings(content).split("\n").join("\r\n");
}

function countLines(content: string): number {
  if (content.length === 0) {
    return 0;
  }
  return splitLines(content).length;
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

  return {
    content: selected.join("\n"),
    startLine: startIndex + 1,
    endLine: startIndex + selected.length,
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

async function ensureFile(filePath: string): Promise<void> {
  const stat = await fs.stat(filePath);
  if (!stat.isFile()) {
    throw new Error(`Path is not a file: ${filePath}`);
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
): Promise<{
  path: string;
  content: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
  sizeBytes: number;
}> {
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
  options?: { maxBytes?: number },
): Promise<BinaryReadResult> {
  return readAttachmentAsBlocksOrBase64(filePath, {
    maxBytes: options?.maxBytes ?? DEFAULT_MAX_READ_BYTES,
    includeMetadata: true,
    unsupportedFormat: "base64",
    onError: "throw",
  });
}

function snippetAroundChange(
  content: string,
  index: number,
  replacementLength: number,
): string {
  const before = content.slice(0, index);
  const startLine = Math.max(0, countLines(before) - SNIPPET_RADIUS);
  const endLine = countLines(before) + replacementLength + SNIPPET_RADIUS;
  const lines = splitLines(content);
  return lines.slice(startLine, endLine).join("\n");
}

function lineNumberForIndex(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (content[i] === "\n") {
      line += 1;
    }
  }

  return line;
}

function buildPatchHunk(
  original: string,
  edited: string,
  oldText: string,
  newText: string,
  index: number,
): StructuredPatchHunk {
  const originalLines = splitLines(original);
  const editedLines = splitLines(edited);
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  const changedLine = lineNumberForIndex(original, index);
  const contextStart = Math.max(1, changedLine - SNIPPET_RADIUS);
  const oldStart = contextStart;
  const newStart = contextStart;
  const prefixContext = originalLines.slice(contextStart - 1, changedLine - 1);
  const oldEnd = changedLine + oldLines.length - 1;
  const suffixContext = originalLines.slice(
    oldEnd,
    Math.min(originalLines.length, oldEnd + SNIPPET_RADIUS),
  );
  const lines = [
    ...prefixContext.map((line) => ` ${line}`),
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`),
    ...suffixContext.map((line) => ` ${line}`),
  ];

  return {
    oldStart,
    oldLines: prefixContext.length + oldLines.length + suffixContext.length,
    newStart,
    newLines: prefixContext.length + newLines.length + suffixContext.length,
    lines,
  };
}

function patchLines(content: string): string[] {
  return content.length === 0 ? [] : splitLines(content);
}

function buildContentPatchHunks(
  original: string,
  edited: string,
): StructuredPatchHunk[] {
  const oldLines = patchLines(original);
  const newLines = patchLines(edited);
  let prefix = 0;
  while (
    prefix < oldLines.length &&
    prefix < newLines.length &&
    oldLines[prefix] === newLines[prefix]
  ) {
    prefix += 1;
  }

  let oldEnd = oldLines.length - 1;
  let newEnd = newLines.length - 1;
  while (
    oldEnd >= prefix &&
    newEnd >= prefix &&
    oldLines[oldEnd] === newLines[newEnd]
  ) {
    oldEnd -= 1;
    newEnd -= 1;
  }

  if (oldEnd < prefix && newEnd < prefix) {
    return [];
  }

  const contextStart = Math.max(0, prefix - SNIPPET_RADIUS);
  const oldSuffixStart = oldEnd + 1;
  const oldSuffixEnd = Math.min(
    oldLines.length,
    oldSuffixStart + SNIPPET_RADIUS,
  );
  const prefixContext = oldLines.slice(contextStart, prefix);
  const removed = oldLines.slice(prefix, oldEnd + 1);
  const added = newLines.slice(prefix, newEnd + 1);
  const suffixContext = oldLines.slice(oldSuffixStart, oldSuffixEnd);

  return [
    {
      oldStart: contextStart + 1,
      oldLines: prefixContext.length + removed.length + suffixContext.length,
      newStart: contextStart + 1,
      newLines: prefixContext.length + added.length + suffixContext.length,
      lines: [
        ...prefixContext.map((line) => ` ${line}`),
        ...removed.map((line) => `-${line}`),
        ...added.map((line) => `+${line}`),
        ...suffixContext.map((line) => ` ${line}`),
      ],
    },
  ];
}

function applyEdits(
  original: string,
  edits: Array<z.infer<typeof EditSchema>>,
): {
  content: string;
  replacements: Array<{
    index: number;
    snippet: string;
    hunk: StructuredPatchHunk;
  }>;
} {
  let current = original;
  const replacements: Array<{
    index: number;
    snippet: string;
    hunk: StructuredPatchHunk;
  }> = [];

  for (const edit of edits) {
    const matches = [
      ...current.matchAll(new RegExp(escapeRegExp(edit.oldText), "g")),
    ];

    if (matches.length === 0) {
      throw new Error(`Could not find edit target:\n${edit.oldText}`);
    }
    if (matches.length > 1) {
      throw new Error(
        `Edit target is ambiguous and appears ${matches.length} times:\n${edit.oldText}`,
      );
    }

    const match = matches[0]!;
    const index = match.index ?? -1;
    const previous = current;
    current =
      current.slice(0, index) +
      edit.newText +
      current.slice(index + edit.oldText.length);

    replacements.push({
      index,
      snippet: snippetAroundChange(current, index, countLines(edit.newText)),
      hunk: buildPatchHunk(
        previous,
        current,
        edit.oldText,
        edit.newText,
        index,
      ),
    });
  }

  return { content: current, replacements };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

      children.push(await build(fullPath, depth + 1));
    }

    node.children = children;
    return node;
  }

  return build(rootPath, 1);
}

async function searchFiles(
  rootPath: string,
  pattern: string,
  options?: { excludePatterns?: string[]; maxResults?: number },
): Promise<string[]> {
  const matcher = globToRegExp(pattern);
  const excludes = (options?.excludePatterns ?? []).map(globToRegExp);
  const maxResults = options?.maxResults ?? DEFAULT_SEARCH_MAX_RESULTS;
  const results: string[] = [];

  async function visit(currentPath: string): Promise<void> {
    if (results.length >= maxResults) {
      return;
    }

    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      if (results.length >= maxResults) {
        return;
      }

      const fullPath = path.join(currentPath, entry.name);
      const relative = normalizeForGlob(
        path.relative(rootPath, fullPath) || entry.name,
      );

      if (excludes.some((exclude) => exclude.test(relative))) {
        continue;
      }

      if (matcher.test(relative) || matcher.test(entry.name)) {
        results.push(fullPath);
      }

      if (entry.isDirectory()) {
        await visit(fullPath);
      }
    }
  }

  await visit(rootPath);
  return results;
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
    }),
    writeFile: z.object({
      path: z.string().describe("File path to write."),
      content: z.string().describe("Content to write."),
      append: z.boolean().optional().describe("Append instead of overwrite."),
      create_parents: z
        .boolean()
        .optional()
        .describe("Create parent directories if needed."),
    }),
    editFile: z.object({
      path: z.string().describe("File path to edit."),
      edits: z
        .array(EditSchema)
        .min(1)
        .describe("Exact text replacements to apply in order."),
      dry_run: z
        .boolean()
        .optional()
        .describe("Preview edits without writing the file."),
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
    searchFiles: z.object({
      path: z.string().describe("Root directory to search."),
      pattern: z
        .string()
        .describe("Glob-style pattern, e.g. '**/*.ts' or '*.md'."),
      exclude_patterns: z.array(z.string()).optional(),
      max_results: z.number().int().min(1).optional(),
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
      callback: async (input) => {
        const filePath = normalizeUserPath(input.path);

        if (input.binary) {
          // Binary reads can return SDK media blocks (ImageBlock / DocumentBlock)
          // or a plain base64 JSON object. Both are accepted by FunctionTool's
          // result wrapping, but the callback signature is JSONValue, so cast.
          const result = await readBinaryFile(filePath);
          return result as unknown as JSONValue;
        }

        const result = await readTextFile(filePath, {
          offset: input.offset,
          limit: input.limit,
        });
        return toJsonValue(result);
      },
    }),
    tool({
      name: "read_multiple_files",
      description:
        "Read multiple text files in one call. Each file is returned independently with success or error details.",
      inputSchema: schema.readMultipleFiles,
      callback: async (input) => {
        const results = await Promise.all(
          input.paths.map(async (itemPath) => {
            const filePath = normalizeUserPath(itemPath);
            try {
              const readResult = await readTextFile(filePath, {
                offset: input.offset,
                limit: input.limit,
              });

              return {
                ok: true,
                ...readResult,
              };
            } catch (error) {
              return {
                path: filePath,
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              };
            }
          }),
        );

        return toJsonValue({ results });
      },
    }),
    tool({
      name: "write_file",
      description:
        "Write text content to a file. Can overwrite or append, and can create parent directories when requested.",
      inputSchema: schema.writeFile,
      callback: async (input, context?: ToolContext) => {
        const filePath = normalizeUserPath(input.path);

        if (input.create_parents ?? true) {
          await fs.mkdir(path.dirname(filePath), { recursive: true });
        }

        let oldContent = "";
        try {
          oldContent = normalizeLineEndings(
            await fs.readFile(filePath, "utf8"),
          );
        } catch {
          oldContent = "";
        }

        if (input.append) {
          await fs.appendFile(filePath, input.content, "utf8");
        } else {
          await fs.writeFile(filePath, input.content, "utf8");
        }

        const newContent = input.append
          ? `${oldContent}${normalizeLineEndings(input.content)}`
          : normalizeLineEndings(input.content);
        const structuredPatch = buildContentPatchHunks(oldContent, newContent);
        if (structuredPatch.length > 0) {
          if (context) {
            setFileToolDisplay(
              context.agent.appState,
              context.toolUse.toolUseId,
              {
                structuredPatch,
              },
            );
          }
        }

        return toJsonValue({
          path: filePath,
          appended: input.append ?? false,
          bytes_written: Buffer.byteLength(input.content, "utf8"),
        });
      },
    }),
    tool({
      name: "edit_file",
      description:
        "Apply exact text replacements to a file. Fails if any replacement target is missing or ambiguous.",
      inputSchema: schema.editFile,
      callback: async (input, context?: ToolContext) => {
        const filePath = normalizeUserPath(input.path);
        const stat = await statFile(filePath);
        const previousRead = textReadState.get(filePath);
        const rawOriginal = await fs.readFile(filePath, "utf8");
        const lineEndings = detectLineEndings(rawOriginal);
        const original = normalizeLineEndings(rawOriginal);

        if (previousRead && stat.mtimeMs > previousRead.mtimeMs) {
          const fullReadWasUnchanged =
            !previousRead.isPartial && previousRead.content === original;
          if (!fullReadWasUnchanged) {
            throw new Error(
              "File changed since it was last read. Read the file again before editing.",
            );
          }
        }

        const edited = applyEdits(original, input.edits);
        const contentToWrite = restoreLineEndings(edited.content, lineEndings);

        if (!input.dry_run) {
          await fs.writeFile(filePath, contentToWrite, "utf8");
          const updatedStat = await fs.stat(filePath);
          textReadState.set(filePath, {
            content: edited.content,
            mtimeMs: updatedStat.mtimeMs,
            offset: 1,
            limit: undefined,
            isPartial: false,
          });
        }

        if (context) {
          setFileToolDisplay(
            context.agent.appState,
            context.toolUse.toolUseId,
            {
              previews: edited.replacements.map((item) => item.snippet),
              structuredPatch: edited.replacements.map((item) => item.hunk),
            },
          );
        }

        return toJsonValue({
          path: filePath,
          dry_run: input.dry_run ?? false,
          edits_applied: input.edits.length,
          changed: edited.content !== original,
          sha256_before: createHash("sha256").update(original).digest("hex"),
          sha256_after: createHash("sha256")
            .update(edited.content)
            .digest("hex"),
        });
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
      name: "search_files",
      description:
        "Recursively search for files and directories under a root path using glob-style matching.",
      inputSchema: schema.searchFiles,
      callback: async (input) => {
        const rootPath = normalizeUserPath(input.path);
        await ensureExists(rootPath);
        await ensureDirectory(rootPath);

        const matches = await searchFiles(rootPath, input.pattern, {
          excludePatterns: input.exclude_patterns,
          maxResults: input.max_results,
        });

        return toJsonValue({
          path: rootPath,
          pattern: input.pattern,
          count: matches.length,
          matches,
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
