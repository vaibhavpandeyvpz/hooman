import * as vscode from "vscode";

/**
 * Native VS Code confirmation modal, shared by destructive actions across
 * the extension (session close/delete, chat revert, config/MCP/skill
 * deletes). Using the platform modal keeps confirmations consistent and
 * accessible, and avoids `window.confirm` (unavailable in the webview) and
 * bespoke in-webview dialogs.
 *
 * Returns `true` only when the user clicks the confirm button.
 */
export async function confirmModal(
  message: string,
  detail: string,
  confirmLabel: string,
): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(
    message,
    { modal: true, detail },
    confirmLabel,
  );
  return choice === confirmLabel;
}

/** {@link confirmModal} preset for delete actions (confirm button reads "Delete"). */
export function confirmDelete(
  message: string,
  detail: string,
): Promise<boolean> {
  return confirmModal(message, detail, "Delete");
}
