import type {
  InboundMessage,
  OutboundMessage,
  WebviewRoute,
} from "../../src/shared/protocol";

interface VsCodeApi {
  postMessage(message: InboundMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscode = acquireVsCodeApi();

function isWebviewRoute(value: string | undefined): value is WebviewRoute {
  return value === "/" || value === "/chat" || !!value?.startsWith("/plans/");
}

function readInitialRoute(): WebviewRoute {
  const raw = document.body.dataset.route;
  return isWebviewRoute(raw) ? raw : "/";
}

/** Initial route injected by the host HTML before the webview app boots. */
export const initialRoute = readInitialRoute();

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
