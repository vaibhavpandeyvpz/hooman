import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

const CALLBACK_HOST = "127.0.0.1";
const DEFAULT_CALLBACK_PATH = "/mcp/oauth/callback";
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export type CallbackResult = {
  code: string;
  state: string;
};

export type CallbackServer = {
  redirectUri: string;
  waitForCode: (options?: {
    signal?: AbortSignal;
    timeoutMs?: number;
  }) => Promise<CallbackResult>;
  close: () => Promise<void>;
};

export async function startCallbackServer(
  options: {
    port?: number;
    path?: string;
  } = {},
): Promise<CallbackServer> {
  const callbackPath = normalizePath(options.path);
  let pending:
    | {
        resolve: (result: CallbackResult) => void;
        reject: (error: Error) => void;
      }
    | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;

  const server = createServer((req, res) => {
    void handleRequest(req, res, callbackPath, pending, () => {
      pending = undefined;
      clearPendingTimeout(timeout);
      timeout = undefined;
    });
  });

  const port = await listen(server, options.port);
  const redirectUri = `http://${CALLBACK_HOST}:${port}${callbackPath}`;

  return {
    redirectUri,
    waitForCode: ({ signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) =>
      new Promise<CallbackResult>((resolve, reject) => {
        pending = { resolve, reject };
        if (signal) {
          const onAbort = () => {
            cleanup();
            reject(new Error("OAuth callback aborted."));
          };
          if (signal.aborted) {
            onAbort();
            return;
          }
          signal.addEventListener("abort", onAbort, { once: true });
        }
        timeout = setTimeout(() => {
          cleanup();
          reject(new Error("OAuth callback timed out."));
        }, timeoutMs);
      }),
    close: async () => {
      cleanup();
      await closeServer(server);
    },
  };

  function cleanup(): void {
    clearPendingTimeout(timeout);
    timeout = undefined;
    if (pending) {
      pending.reject(new Error("OAuth callback server closed."));
      pending = undefined;
    }
  }
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  callbackPath: string,
  pending:
    | {
        resolve: (result: CallbackResult) => void;
        reject: (error: Error) => void;
      }
    | undefined,
  complete: () => void,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== callbackPath) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  if (error) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderErrorPage(errorDescription || error));
    pending?.reject(new Error(`OAuth error: ${errorDescription || error}`));
    complete();
    return;
  }

  if (!state || !code) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderErrorPage("Missing required code or state parameter."));
    return;
  }

  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(renderSuccessPage());
  pending?.resolve({ code, state });
  complete();
}

function renderSuccessPage(): string {
  return `<!doctype html><html><body><h1>Authentication complete</h1><p>You can close this window and return to Hooman.</p></body></html>`;
}

function renderErrorPage(message: string): string {
  return `<!doctype html><html><body><h1>Authentication failed</h1><p>${escapeHtml(message)}</p></body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function clearPendingTimeout(
  timeout: ReturnType<typeof setTimeout> | undefined,
): void {
  if (timeout) {
    clearTimeout(timeout);
  }
}

function normalizePath(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return DEFAULT_CALLBACK_PATH;
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

async function listen(
  server: ReturnType<typeof createServer>,
  preferredPort?: number,
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(preferredPort ?? 0, CALLBACK_HOST, () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to determine OAuth callback port."));
        return;
      }
      resolve(address.port);
    });
  });
}

async function closeServer(
  server: ReturnType<typeof createServer>,
): Promise<void> {
  if (!server.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
