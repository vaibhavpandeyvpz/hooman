import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { tool } from "@strands-agents/sdk";
import { getCwd } from "../utils/cwd-context.ts";
import type { JSONValue } from "@strands-agents/sdk";
import { z } from "zod";

const DEFAULT_READ_LIMIT = 250;
const DEFAULT_MAX_READ_BYTES = 1024 * 1024;
const DEFAULT_SEARCH_MAX_RESULTS = 500;
const DEFAULT_TREE_DEPTH = 4;
const SNIPPET_RADIUS = 3;

const EditSchema = z.object({
  oldText: z.string().describe("Exact text to find. Must match uniquely."),
  newText: z.string().describe("Replacement text."),
});

type TreeNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: TreeNode[];
};

function toJsonValue(value: unknown): JSONValue {
  return JSON.parse(JSON.stringify(value)) as JSONValue;
}

function expandHome(inputPath: string): string {
  if (inputPath === "~" || inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(1));
  }
  return inputPath;
}

function normalizeUserPath(inputPath: string): string {
  let value = inputPath.trim().replace(/^["']|["']$/g, "");

  if (process.platform === "win32" && /^\/[a-zA-Z]\//.test(value)) {
    const drive = value[1]!.toUpperCase();
    value = `${drive}:${value.slice(2).replace(/\//g, "\\")}`;
  }

  value = expandHome(value);

  return path.isAbsolute(value)
    ? path.resolve(value)
    : path.resolve(getCwd(), value);
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
  await ensureFile(filePath);
  const stat = await fs.stat(filePath);

  if (stat.size > (options?.maxBytes ?? DEFAULT_MAX_READ_BYTES)) {
    throw new Error(
      `File too large to read safely (${stat.size} bytes). Use a narrower read or another tool.`,
    );
  }

  const buffer = await fs.readFile(filePath);
  if (isProbablyBinary(buffer)) {
    throw new Error(
      "File appears to be binary. Use get_file_info or read_file with as_base64 if you extend the tool for binary reads.",
    );
  }

  const excerpt = makeLineExcerpt(
    buffer.toString("utf8"),
    options?.offset,
    options?.limit,
  );

  return {
    path: filePath,
    content: excerpt.content,
    startLine: excerpt.startLine,
    endLine: excerpt.endLine,
    totalLines: excerpt.totalLines,
    truncated: excerpt.truncated,
    sizeBytes: stat.size,
  };
}

async function readBinaryFile(filePath: string): Promise<{
  path: string;
  encoding: "base64";
  content: string;
  sizeBytes: number;
}> {
  await ensureFile(filePath);
  const buffer = await fs.readFile(filePath);

  return {
    path: filePath,
    encoding: "base64",
    content: buffer.toString("base64"),
    sizeBytes: buffer.length,
  };
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

function applyEdits(
  original: string,
  edits: Array<z.infer<typeof EditSchema>>,
): {
  content: string;
  replacements: Array<{ index: number; snippet: string }>;
} {
  let current = original;
  const replacements: Array<{ index: number; snippet: string }> = [];

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
    current =
      current.slice(0, index) +
      edit.newText +
      current.slice(index + edit.oldText.length);

    replacements.push({
      index,
      snippet: snippetAroundChange(current, index, countLines(edit.newText)),
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
        .describe("Return file as base64 instead of UTF-8 text."),
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
        "Read a text file with optional line offset/limit. For binary files, enable the `binary` option to return base64.",
      inputSchema: schema.readFile,
      callback: async (input) => {
        const filePath = normalizeUserPath(input.path);
        const result = input.binary
          ? await readBinaryFile(filePath)
          : await readTextFile(filePath, {
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
      callback: async (input) => {
        const filePath = normalizeUserPath(input.path);

        if (input.create_parents ?? true) {
          await fs.mkdir(path.dirname(filePath), { recursive: true });
        }

        if (input.append) {
          await fs.appendFile(filePath, input.content, "utf8");
        } else {
          await fs.writeFile(filePath, input.content, "utf8");
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
      callback: async (input) => {
        const filePath = normalizeUserPath(input.path);
        await ensureFile(filePath);
        const original = await fs.readFile(filePath, "utf8");
        const edited = applyEdits(original, input.edits);

        if (!input.dry_run) {
          await fs.writeFile(filePath, edited.content, "utf8");
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
          previews: edited.replacements.map((item) => item.snippet),
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
