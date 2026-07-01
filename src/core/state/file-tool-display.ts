import type { JSONValue } from "@strands-agents/sdk";

const FILE_TOOL_DISPLAY_STATE_KEY = "fileToolDisplay";

export type StructuredPatchHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
};

export type FileToolDisplay = {
  previews?: string[];
  structuredPatch?: StructuredPatchHunk[];
  /** Absolute path of the file this tool modified (ACP diffs + follow-along). */
  path?: string;
  /** Full content before the change; `null` when the file was newly created. */
  oldText?: string | null;
  /** Full content after the change. */
  newText?: string;
};

type DisplayStateStore = {
  get(key: string): JSONValue | undefined;
  set(key: string, value: unknown): void;
  delete(key: string): void;
};

function readDisplayState(
  appState: DisplayStateStore,
): Record<string, FileToolDisplay> {
  const value = appState.get(FILE_TOOL_DISPLAY_STATE_KEY);
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, FileToolDisplay>)
    : {};
}

export function setFileToolDisplay(
  appState: DisplayStateStore,
  toolUseId: string | undefined,
  display: FileToolDisplay,
): void {
  if (!toolUseId) {
    return;
  }

  appState.set(FILE_TOOL_DISPLAY_STATE_KEY, {
    ...readDisplayState(appState),
    [toolUseId]: display,
  });
}

export function takeFileToolDisplay(
  appState: DisplayStateStore,
  toolUseId: string | null,
): FileToolDisplay | undefined {
  if (!toolUseId) {
    return undefined;
  }

  const state = readDisplayState(appState);
  const display = state[toolUseId];
  if (!display) {
    return undefined;
  }

  const { [toolUseId]: _removed, ...nextState } = state;
  if (Object.keys(nextState).length === 0) {
    appState.delete(FILE_TOOL_DISPLAY_STATE_KEY);
  } else {
    appState.set(FILE_TOOL_DISPLAY_STATE_KEY, nextState);
  }

  return display;
}
