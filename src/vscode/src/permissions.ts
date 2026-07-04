import * as vscode from "vscode";
import type {
  RequestPermissionRequest,
  RequestPermissionResponse,
} from "@agentclientprotocol/sdk";

/**
 * A surface (e.g. the webview chat panel) that can render a permission
 * request inline. Returns `undefined` when it can't handle this request
 * (e.g. panel hidden, session not active there), letting the fallback run.
 */
export type InlinePermissionDelegate = (
  sessionKey: string,
  request: RequestPermissionRequest,
  cancellation: vscode.CancellationToken,
) => Promise<RequestPermissionResponse> | undefined;

/**
 * Resolves ACP `session/request_permission` prompts.
 *
 * Resolution order:
 * 1. An inline delegate (the Hooman webview chat panel) when it claims the
 *    session.
 * 2. A modal dialog, which works regardless of what else is installed.
 */
export class PermissionPrompts implements vscode.Disposable {
  #inlineDelegate: InlinePermissionDelegate | undefined;

  constructor(private readonly outputChannel: vscode.LogOutputChannel) {}

  /** Register the surface that gets first shot at rendering permission prompts. */
  setInlineDelegate(delegate: InlinePermissionDelegate | undefined): void {
    this.#inlineDelegate = delegate;
  }

  async requestPermission(
    sessionKey: string,
    request: RequestPermissionRequest,
    cancellation: vscode.CancellationToken,
  ): Promise<RequestPermissionResponse> {
    const inline = this.#inlineDelegate?.(sessionKey, request, cancellation);
    if (inline) {
      try {
        return await inline;
      } catch (error) {
        this.outputChannel.warn(
          `[permissions] inline prompt failed, falling back: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return this.#viaModal(request);
  }

  dispose(): void {}

  async #viaModal(
    request: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> {
    const title = request.toolCall.title ?? "Tool call";
    const isQuestion = request._meta?.["hoomanjs/ask_user"] === true;
    const message = this.#describe(request);
    const buttons = request.options.map((option) => option.name);
    const choice = isQuestion
      ? await vscode.window.showInformationMessage(
          title,
          { modal: true },
          ...buttons,
        )
      : await vscode.window.showWarningMessage(
          `Hooman wants to run: ${title}`,
          { modal: true, detail: message },
          ...buttons,
        );
    if (!choice) {
      return { outcome: { outcome: "cancelled" } };
    }
    const option = request.options.find((o) => o.name === choice);
    if (!option) {
      return { outcome: { outcome: "cancelled" } };
    }
    return { outcome: { outcome: "selected", optionId: option.optionId } };
  }

  #describe(request: RequestPermissionRequest): string {
    const content = request.toolCall.content
      ?.map((c) =>
        c.type === "content" && c.content.type === "text"
          ? c.content.text
          : undefined,
      )
      .find((text): text is string => Boolean(text));
    return content ?? `Kind: ${request.toolCall.kind ?? "other"}`;
  }
}
