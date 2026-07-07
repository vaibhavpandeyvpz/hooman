import * as vscode from "vscode";
import type { PlanEditorProvider } from "./plan-editor";
import { openPlanEditor } from "./plan-editor";

const PLAN_FILE_SUFFIX = ".plan.md";

export function isPlanFilePath(path: string): boolean {
  return path.toLowerCase().endsWith(PLAN_FILE_SUFFIX);
}

export function isPlanFileUri(uri: vscode.Uri | undefined): boolean {
  return uri?.scheme === "file" && isPlanFilePath(uri.fsPath);
}

/**
 * Open or activate a plan file in Hooman's custom plan surface when available,
 * falling back to a preview text editor otherwise.
 */
export async function revealPlanFile(
  uri: vscode.Uri,
  options?: {
    preserveFocus?: boolean;
    viewColumn?: vscode.ViewColumn;
    provider?: PlanEditorProvider;
  },
): Promise<void> {
  if (!isPlanFileUri(uri)) {
    return;
  }
  await openPlanEditor(options?.provider, uri, options);
}
