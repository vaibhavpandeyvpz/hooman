import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { FsBackend } from "../backend.js";
import {
  findReplacementSpan,
  unescapeModelText,
} from "../../utils/edit-replace.js";
import type { EditResult, FileEdit } from "./types.js";

export type FileEditDisplay = {
  path: string;
  oldText: string | null;
  newText: string;
};

export type FileEditDisplayCapture = (display: FileEditDisplay) => void;

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function applyInsert(
  original: string,
  edit: Extract<FileEdit, { mode: "insert" }>,
): string {
  const lineEnding = original.includes("\r\n") ? "\r\n" : "\n";
  const endsWithNewline = original.endsWith("\n");
  const lines =
    original.length === 0 ? [] : original.replaceAll("\r\n", "\n").split("\n");
  if (endsWithNewline) lines.pop();
  const at = edit.insert_at;
  if (at < 1 || at > lines.length + 1)
    throw new Error(`insert_at must be between 1 and ${lines.length + 1}.`);
  const inserted = edit.content.replaceAll("\r\n", "\n").split("\n");
  if (edit.content.endsWith("\n")) inserted.pop();
  lines.splice(at - 1, 0, ...inserted);
  return lines.join(lineEnding) + (endsWithNewline ? lineEnding : "");
}

async function sourceContent(
  backend: FsBackend,
  filePath: string,
  expected?: string,
): Promise<string> {
  const content = await backend.readTextFile(filePath);
  if (expected && sha256(content) !== expected)
    throw new Error(
      `File content hash did not match for ${filePath}. Read it again before editing.`,
    );
  return content;
}

export async function applyFileEdit(
  backend: FsBackend,
  edit: FileEdit,
  captureDisplay?: FileEditDisplayCapture,
): Promise<EditResult> {
  if (edit.mode === "write") {
    let prior: string | undefined;
    let baselineKnown = false;
    try {
      prior = await backend.readTextFile(edit.path);
      baselineKnown = true;
    } catch (error) {
      baselineKnown =
        backend.kind === "local" &&
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT";
    }
    if (
      prior !== undefined &&
      edit.expected_sha256 &&
      sha256(prior) !== edit.expected_sha256
    )
      throw new Error(`File content hash did not match for ${edit.path}.`);
    if (backend.kind === "local")
      await fs.mkdir(path.dirname(edit.path), { recursive: true });
    await backend.writeTextFile(edit.path, edit.content);
    const changed = prior !== edit.content;
    if (changed && baselineKnown) {
      captureDisplay?.({
        path: edit.path,
        oldText: prior ?? null,
        newText: edit.content,
      });
    }
    return { path: edit.path, mode: edit.mode, changed };
  }
  const original = await sourceContent(
    backend,
    edit.path,
    edit.expected_sha256,
  );
  if (edit.mode === "replace") {
    if (edit.old_text.length === 0) {
      throw new Error(
        "old_text must not be empty. Use mode 'write' to replace the whole file.",
      );
    }
    let next = original;
    let replacements = 0;
    if (edit.replace_all && next.includes(edit.old_text)) {
      replacements = next.split(edit.old_text).length - 1;
      next = next.replaceAll(edit.old_text, () => edit.new_text);
    } else {
      const match = findReplacementSpan(next, edit.old_text);
      const replacement =
        match.text === unescapeModelText(edit.old_text) &&
        match.text !== edit.old_text
          ? unescapeModelText(edit.new_text)
          : edit.new_text;
      next =
        next.slice(0, match.index) +
        replacement +
        next.slice(match.index + match.text.length);
      replacements = 1;
    }
    await backend.writeTextFile(edit.path, next);
    const changed = next !== original;
    if (changed) {
      captureDisplay?.({ path: edit.path, oldText: original, newText: next });
    }
    return {
      path: edit.path,
      mode: edit.mode,
      changed,
      replacements,
    };
  }
  if (edit.mode === "insert") {
    const next = applyInsert(original, edit);
    await backend.writeTextFile(edit.path, next);
    const changed = next !== original;
    if (changed) {
      captureDisplay?.({ path: edit.path, oldText: original, newText: next });
    }
    return { path: edit.path, mode: edit.mode, changed };
  }
  if (edit.mode === "rename") {
    try {
      await fs.access(edit.new_path);
      throw new Error(`Rename destination already exists: ${edit.new_path}`);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("Rename destination")
      )
        throw error;
    }
    await fs.mkdir(path.dirname(edit.new_path), { recursive: true });
    await backend.writeTextFile(edit.new_path, original);
    await backend.writeTextFile(edit.path, "");
    await fs.rm(edit.path);
    return {
      path: edit.path,
      mode: edit.mode,
      changed: true,
      new_path: edit.new_path,
    };
  }
  await backend.writeTextFile(edit.path, "");
  await fs.rm(edit.path);
  return { path: edit.path, mode: edit.mode, changed: true };
}

export async function applyFileEdits(
  backend: FsBackend,
  edits: FileEdit[],
): Promise<EditResult[]> {
  if (edits.length === 0) throw new Error("At least one edit is required.");
  const results: EditResult[] = [];
  for (const edit of edits) {
    results.push(await applyFileEdit(backend, edit));
  }
  return results;
}
