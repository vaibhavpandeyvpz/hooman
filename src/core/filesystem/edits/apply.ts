import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { FsBackend } from "../backend.js";
import type { EditResult, FileEdit } from "./types.js";

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function applyLineEdit(
  original: string,
  edit: Extract<FileEdit, { mode: "edit" }>,
): string {
  const lineEnding = original.includes("\r\n") ? "\r\n" : "\n";
  const endsWithNewline = original.endsWith("\n");
  const lines =
    original.length === 0 ? [] : original.replaceAll("\r\n", "\n").split("\n");
  if (endsWithNewline) lines.pop();
  const at = edit.insert_at;
  if (at < 1 || at > lines.length + 1)
    throw new Error(`insert_at must be between 1 and ${lines.length + 1}.`);
  const replacement = edit.content.replaceAll("\r\n", "\n").split("\n");
  if (edit.content.endsWith("\n")) replacement.pop();
  const until = edit.replace_until;
  if (until !== undefined && until !== null) {
    if (until < at || until > lines.length)
      throw new Error(
        `replace_until must be between ${at} and ${lines.length}.`,
      );
    lines.splice(at - 1, until - at + 1, ...replacement);
  } else {
    lines.splice(at - 1, 0, ...replacement);
  }
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
): Promise<EditResult> {
  if (edit.mode === "write") {
    let prior: string | undefined;
    try {
      prior = await backend.readTextFile(edit.path);
    } catch {
      /* creating */
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
    return {
      path: edit.path,
      mode: edit.mode,
      changed: prior !== edit.content,
    };
  }
  const original = await sourceContent(
    backend,
    edit.path,
    edit.expected_sha256,
  );
  if (edit.mode === "edit") {
    const next = applyLineEdit(original, edit);
    await backend.writeTextFile(edit.path, next);
    return { path: edit.path, mode: edit.mode, changed: next !== original };
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
  const paths = new Set<string>();
  for (const edit of edits) {
    for (const item of edit.mode === "rename"
      ? [edit.path, edit.new_path]
      : [edit.path]) {
      if (paths.has(item)) throw new Error(`Conflicting edits target ${item}.`);
      paths.add(item);
    }
  }
  return Promise.all(edits.map((edit) => applyFileEdit(backend, edit)));
}
