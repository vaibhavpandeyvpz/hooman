import { useMemo } from "react";
import type { ChatLine } from "../../types.ts";

export type StructuredPatchHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
};

export type FileToolResult =
  | {
      kind: "write";
      toolName: "write_file";
      path: string;
      appended: boolean;
      bytesWritten?: number;
      structuredPatch: StructuredPatchHunk[];
    }
  | {
      kind: "edit";
      toolName: "edit_file";
      path: string;
      dryRun: boolean;
      editsApplied?: number;
      changed?: boolean;
      previews: string[];
      structuredPatch: StructuredPatchHunk[];
    };

type WriteFileInput = {
  path: string;
  append?: boolean;
};

type WriteFileResult = {
  path: string;
  appended: boolean;
  bytes_written: number;
};

type EditFileInput = {
  path: string;
  edits: Array<{
    oldText: string;
    newText: string;
  }>;
  dry_run?: boolean;
};

type EditFileResult = {
  path: string;
  dry_run: boolean;
  edits_applied: number;
  changed: boolean;
};

function parseJson<T>(raw: string | undefined): T | null {
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function useFileToolResult(line: ChatLine): FileToolResult | null {
  return useMemo(
    () =>
      parseFileToolResult({
        phase: line.phase,
        toolName: line.toolName,
        inputContent: line.content,
        resultContent: line.resultContent,
        structuredPatch: line.fileToolDisplay?.structuredPatch,
        previews: line.fileToolDisplay?.previews,
      }),
    [
      line.content,
      line.fileToolDisplay?.previews,
      line.fileToolDisplay?.structuredPatch,
      line.phase,
      line.resultContent,
      line.toolName,
    ],
  );
}

function parseFileToolResult({
  phase,
  toolName,
  inputContent,
  resultContent,
  previews,
  structuredPatch,
}: {
  phase: ChatLine["phase"];
  toolName: string | undefined;
  inputContent: string;
  resultContent?: string;
  previews?: string[];
  structuredPatch?: StructuredPatchHunk[];
}): FileToolResult | null {
  if (toolName === "write_file") {
    const input = parseJson<WriteFileInput>(inputContent);
    const result = parseJson<WriteFileResult>(resultContent);
    if (phase === "done" && !result) {
      return null;
    }

    const path = result?.path ?? input?.path;
    if (!path) {
      return null;
    }

    return {
      kind: "write",
      toolName,
      path,
      appended: result?.appended ?? input?.append ?? false,
      bytesWritten: result?.bytes_written,
      structuredPatch: structuredPatch ?? [],
    };
  }

  if (toolName === "edit_file") {
    const input = parseJson<EditFileInput>(inputContent);
    const result = parseJson<EditFileResult>(resultContent);
    if (phase === "done" && !result) {
      return null;
    }

    const path = result?.path ?? input?.path;
    if (!path) {
      return null;
    }

    return {
      kind: "edit",
      toolName,
      path,
      dryRun: result?.dry_run ?? input?.dry_run ?? false,
      editsApplied: result?.edits_applied ?? input?.edits?.length,
      changed: result?.changed,
      previews: previews ?? [],
      structuredPatch: structuredPatch ?? [],
    };
  }

  return null;
}
