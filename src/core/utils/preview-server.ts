import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  watch,
  type FSWatcher,
  createReadStream as fsCreateReadStream,
} from "node:fs";
import { access, readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { PassThrough } from "node:stream";
import serveHandler from "serve-handler";
import { isResolvedPathInsideDir } from "./normalize-user-path.js";

const LIVE_RELOAD_PATH = "/__hooman_live_reload";

const LIVE_RELOAD_SNIPPET = `
<script data-hooman-live-reload>
(function () {
  try {
    var es = new EventSource(${JSON.stringify(LIVE_RELOAD_PATH)});
    es.onmessage = function () { location.reload(); };
    es.onerror = function () { /* browser will retry */ };
  } catch (e) {}
})();
</script>
`;

export type PreviewServer = {
  rootDir: string;
  port: number;
  baseUrl: string;
  /** Absolute URL for a file under the server root. */
  urlFor(filePath: string): string;
  close(): Promise<void>;
};

type ActivePreviewServer = PreviewServer & {
  server: Server;
  watcher: FSWatcher;
  clients: Set<ServerResponse>;
};

/** Live preview servers keyed by absolute serve root. */
const serversByRoot = new Map<string, ActivePreviewServer>();

function injectLiveReload(html: string): string {
  if (html.includes("data-hooman-live-reload")) {
    return html;
  }
  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${LIVE_RELOAD_SNIPPET}</body>`);
  }
  return `${html}\n${LIVE_RELOAD_SNIPPET}`;
}

function broadcastReload(active: ActivePreviewServer): void {
  for (const res of active.clients) {
    try {
      res.write(`data: reload\n\n`);
    } catch {
      active.clients.delete(res);
    }
  }
}

async function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Preview server failed to bind a port."));
        return;
      }
      resolveListen(addr.port);
    });
  });
}

function requestPathname(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  } catch {
    return "/";
  }
}

async function handleRequest(
  active: ActivePreviewServer,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (requestPathname(req) === LIVE_RELOAD_PATH) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.write("\n");
    active.clients.add(res);
    req.on("close", () => {
      active.clients.delete(res);
    });
    return;
  }

  await serveHandler(
    req,
    res,
    {
      public: active.rootDir,
      cleanUrls: false,
      directoryListing: false,
      headers: [
        {
          source: "**",
          headers: [{ key: "Cache-Control", value: "no-store" }],
        },
        {
          // Injected HTML length differs from on-disk size — drop Content-Length.
          source: "**/*.@(html|htm)",
          headers: [
            {
              key: "Content-Length",
              value: null as unknown as string,
            },
          ],
        },
      ],
    },
    {
      createReadStream(filePath, options) {
        const path =
          typeof filePath === "string"
            ? filePath
            : Buffer.isBuffer(filePath)
              ? filePath.toString("utf8")
              : filePath.toString();
        if (/\.html?$/i.test(path)) {
          const stream = new PassThrough();
          void readFile(path, "utf8")
            .then((raw) => {
              stream.end(Buffer.from(injectLiveReload(raw), "utf8"));
            })
            .catch((error: unknown) => {
              stream.destroy(
                error instanceof Error ? error : new Error(String(error)),
              );
            });
          return stream as unknown as ReturnType<typeof fsCreateReadStream>;
        }
        return fsCreateReadStream(filePath, options);
      },
    },
  );
}

/**
 * Start a localhost static file server with SSE live-reload.
 * Servers are keyed by absolute `rootDir`; calling again for the same root
 * returns the existing server.
 *
 * @param rootDir Absolute directory to serve.
 * @param port Bind port; `0` (default) picks an ephemeral free port.
 */
export async function createPreviewServer(
  rootDirRaw: string,
  port = 0,
): Promise<PreviewServer> {
  const rootDir = resolve(rootDirRaw);
  await access(rootDir);

  const existing = serversByRoot.get(rootDir);
  if (existing) {
    return existing;
  }

  const clients = new Set<ServerResponse>();
  const server = createServer((req, res) => {
    void handleRequest(active, req, res).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500).end("Preview server error");
      } else {
        res.end();
      }
    });
  });

  const boundPort = await listen(server, port);
  const baseUrl = `http://127.0.0.1:${boundPort}`;

  let debounce: ReturnType<typeof setTimeout> | undefined;
  const watcher = watch(rootDir, { recursive: true }, () => {
    if (debounce) {
      clearTimeout(debounce);
    }
    debounce = setTimeout(() => broadcastReload(active), 80);
  });
  watcher.on("error", () => {
    /* ignore watcher errors on some platforms */
  });

  const active: ActivePreviewServer = {
    rootDir,
    port: boundPort,
    baseUrl,
    server,
    watcher,
    clients,
    urlFor(filePath: string) {
      const resolved = resolve(filePath);
      if (!isResolvedPathInsideDir(resolved, rootDir)) {
        throw new Error(
          `Preview file must stay under the served root (${rootDir}).`,
        );
      }
      const rel = relative(rootDir, resolved).split(sep).join("/");
      return `${baseUrl}/${rel}`;
    },
    async close() {
      if (debounce) {
        clearTimeout(debounce);
      }
      for (const res of clients) {
        try {
          res.end();
        } catch {
          /* ignore */
        }
      }
      clients.clear();
      watcher.close();
      await new Promise<void>((resolveClose, reject) => {
        server.close((err) => (err ? reject(err) : resolveClose()));
      });
      if (serversByRoot.get(rootDir) === active) {
        serversByRoot.delete(rootDir);
      }
    },
  };

  serversByRoot.set(rootDir, active);
  return active;
}

export function getPreviewServer(
  rootDirRaw: string,
): PreviewServer | undefined {
  return serversByRoot.get(resolve(rootDirRaw));
}

export async function stopPreviewServer(rootDirRaw: string): Promise<boolean> {
  const active = serversByRoot.get(resolve(rootDirRaw));
  if (!active) {
    return false;
  }
  await active.close();
  return true;
}

export function listPreviewServerRoots(): string[] {
  return [...serversByRoot.keys()];
}
