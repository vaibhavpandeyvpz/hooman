import type {
  InboundMessage,
  OutboundMessage,
} from "../../src/shared/protocol";

interface VsCodeApi {
  postMessage(message: InboundMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

/** Send a typed message to the extension host. */
export function post(message: InboundMessage): void {
  vscode.postMessage(message);
}

/** Subscribe to typed messages from the extension host. Returns an unsubscribe function. */
export function onHostMessage(
  handler: (message: OutboundMessage) => void,
): () => void {
  const listener = (event: MessageEvent<OutboundMessage>) =>
    handler(event.data);
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}
