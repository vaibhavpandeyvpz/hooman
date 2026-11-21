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
export async function openPlanFile(
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

/**
 * Open a file while routing Hooman plan files through the custom plan editor.
 */
export async function openFile(
  uri: vscode.Uri,
  options?: {
    preserveFocus?: boolean;
    viewColumn?: vscode.ViewColumn;
    preview?: boolean;
    provider?: PlanEditorProvider;
    selection?: vscode.Range;
  },
): Promise<void> {
  if (isPlanFileUri(uri)) {
    await openPlanFile(uri, options);
    return;
  }
  if (options?.selection) {
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, {
      selection: options.selection,
      preserveFocus: options.preserveFocus ?? false,
      preview: options?.preview ?? true,
      viewColumn: options?.viewColumn,
    });
    return;
  }
  await vscode.commands.executeCommand("vscode.open", uri, {
    preview: options?.preview ?? true,
    preserveFocus: options?.preserveFocus ?? false,
    viewColumn: options?.viewColumn,
  });
}
