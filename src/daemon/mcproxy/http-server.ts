import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import type { Server as McpServerInstance } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

const ENDPOINT = "/mcp";
const MAX_BODY_BYTES = 1024 * 1024;

type SessionEntry = {
  server: McpServerInstance;
  transport: StreamableHTTPServerTransport;
};

export type DaemonMcpHttpHandle = {
  /** `http://127.0.0.1:<port>/mcp` for the resolved (fixed or ephemeral) port. */
  url: string;
  close(): Promise<void>;
};

function jsonRpcError(id: unknown, code: number, message: string): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message },
  });
}

function requestId(body: unknown): unknown {
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    !("id" in body)
  ) {
    return null;
  }
  return (body as { id?: unknown }).id;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error("Request body exceeds the 1 MiB limit.");
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : undefined;
}

/**
 * Hand-rolled loopback-only Streamable HTTP host for the daemon's aggregate
 * MCP proxy: one stateful session per initialize handshake, no auth (the
 * service is process-local and never reachable off-host), no CORS/legacy SSE.
 */
export async function startDaemonMcpHttpServer(options: {
  port: number;
  createSession: () => McpServerInstance;
}): Promise<DaemonMcpHttpHandle> {
  const sessions = new Map<string, SessionEntry>();

  async function handleInitialize(
    req: IncomingMessage,
    res: ServerResponse,
    body: unknown,
  ): Promise<void> {
    if (!isInitializeRequest(body)) {
      res
        .writeHead(400, { "Content-Type": "application/json" })
        .end(
          jsonRpcError(
            requestId(body),
            -32600,
            "Missing Mcp-Session-Id and body is not an initialize request.",
          ),
        );
      return;
    }
    const mcpServer = options.createSession();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        sessions.set(sessionId, { server: mcpServer, transport });
      },
      onsessionclosed: (sessionId) => {
        sessions.delete(sessionId);
        void mcpServer.close().catch(() => undefined);
      },
    });
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://127.0.0.1");
    } catch {
      res.writeHead(400).end();
      return;
    }
    if (url.pathname !== ENDPOINT) {
      res.writeHead(404).end();
      return;
    }
    if (
      req.method !== "POST" &&
      req.method !== "GET" &&
      req.method !== "DELETE"
    ) {
      res.writeHead(405, { Allow: "POST, GET, DELETE" }).end();
      return;
    }

    const sessionIdHeader = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(sessionIdHeader)
      ? sessionIdHeader[0]
      : sessionIdHeader;

    if (req.method === "POST") {
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        res
          .writeHead(400, { "Content-Type": "application/json" })
          .end(
            jsonRpcError(
              null,
              -32700,
              error instanceof Error ? error.message : "Invalid JSON body.",
            ),
          );
        return;
      }

      if (!sessionId) {
        await handleInitialize(req, res, body);
        return;
      }

      const entry = sessions.get(sessionId);
      if (!entry) {
        res
          .writeHead(404, { "Content-Type": "application/json" })
          .end(jsonRpcError(requestId(body), -32001, "Unknown session."));
        return;
      }
      await entry.transport.handleRequest(req, res, body);
      return;
    }

    // GET (SSE stream) / DELETE (session termination) require a known session.
    if (!sessionId) {
      res.writeHead(400).end();
      return;
    }
    const entry = sessions.get(sessionId);
    if (!entry) {
      res.writeHead(404).end();
      return;
    }
    await entry.transport.handleRequest(req, res);
  }

  const httpServer = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500).end();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(options.port, "127.0.0.1", () => {
      httpServer.off("error", reject);
      resolve();
    });
  });
  const address = httpServer.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${address.port}${ENDPOINT}`,
    async close(): Promise<void> {
      await Promise.all(
        [...sessions.values()].map(({ transport }) =>
          transport.close().catch(() => undefined),
        ),
      );
      sessions.clear();
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    },
  };
}
