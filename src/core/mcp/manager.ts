import { McpClient, type Tool } from "@strands-agents/sdk";
import { PrefixedMcpTool } from "./prefixed-mcp-tool.ts";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { get } from "lodash";
import { z } from "zod";
import { Config, type NamedMcpTransport } from "./config.ts";
import type { McpTransport } from "./types.ts";

export const HOOMAN_CHANNEL = "hooman/channel";
export const HOOMAN_CHANNEL_PERMISSION = "hooman/channel/permission";
const HOOMAN_CHANNEL_PERMISSION_METHOD = `notifications/${HOOMAN_CHANNEL_PERMISSION}`;

export type ChannelMessageMeta = {
  server: string;
  channel: string;
  method: string;
  params: unknown;
  source?: string;
  identity: {
    user?: string;
    session?: string;
    thread?: string;
  };
};

export type ChannelMessage = {
  prompt: string;
  meta: ChannelMessageMeta;
};

export type ChannelPermissionBehavior = "allow_once" | "allow_always" | "deny";

type ChannelPermissionRequest = {
  requestId: string;
  tool: string;
  description: string;
  preview: string;
  source?: string;
  user?: string;
  session?: string;
  thread?: string;
};

function transportFor(spec: McpTransport): Transport {
  switch (spec.type) {
    case "stdio":
      return new StdioClientTransport({
        command: spec.command,
        args: spec.args,
        env: spec.env,
        cwd: spec.cwd,
        stderr: "ignore",
      });
    case "streamable-http": {
      const headers = spec.headers;
      return new StreamableHTTPClientTransport(new URL(spec.url), {
        requestInit: headers ? { headers } : undefined,
      });
    }
    case "sse": {
      const headers = spec.headers;
      return new SSEClientTransport(new URL(spec.url), {
        requestInit: headers ? { headers } : undefined,
      });
    }
    default: {
      const _exhaustive: never = spec;
      return _exhaustive;
    }
  }
}

function readPathValue(
  value: unknown,
  path: string | undefined,
): string | undefined {
  const key = path?.trim();
  if (!key) {
    return undefined;
  }

  const current = get(value, key);
  if (typeof current !== "string") {
    return undefined;
  }

  const trimmed = current.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readIdentityPath(
  experimental: unknown,
  key: "hooman/user" | "hooman/session" | "hooman/thread",
): string | undefined {
  const path = get(experimental, [key, "path"]);
  return typeof path === "string" && path.trim().length > 0
    ? path.trim()
    : undefined;
}

function readSourceValue(value: unknown): string | undefined {
  return readPathValue(value, "meta.source");
}

/**
 * Holds one {@link McpClient} per named entry in {@link Config}. Call {@link reload}
 * after changing the file on disk (or construct and then {@link reload} once).
 */
export class Manager {
  private instances: Map<string, McpClient> | null = null;
  private readonly pendingPermissions = new Map<
    string,
    {
      resolve: (behavior: ChannelPermissionBehavior) => void;
      reject: (reason: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  public constructor(
    private readonly config: Config,
    private readonly mcpServers: readonly NamedMcpTransport[] = [],
  ) {}

  /** Lazily builds clients from the current in-memory config (reloads file first). */
  get clients(): ReadonlyMap<string, McpClient> {
    if (this.instances === null) {
      this.reload();
    }
    return this.instances!;
  }

  /**
   * Rereads the config file, replaces all clients, and best-effort disconnects
   * previous clients (stdio subprocesses, HTTP sessions).
   */
  public reload(): void {
    this.config.reload();
    const previous = this.instances;
    const next = new Map<string, McpClient>();
    const transports = [
      ...this.config.list(),
      // Session-scoped ACP servers intentionally override local config names.
      ...this.mcpServers,
    ];
    for (const { name, transport } of transports) {
      next.set(
        name,
        new McpClient({
          transport: transportFor(transport),
        }),
      );
    }
    this.instances = next;
    if (previous?.size) {
      for (const client of previous.values()) {
        void client.disconnect().catch(() => {});
      }
    }
  }

  public async disconnect(): Promise<void> {
    for (const [key, pending] of this.pendingPermissions.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Pending permission "${key}" cancelled.`));
    }
    this.pendingPermissions.clear();
    const toClose = this.instances;
    this.instances = null;
    if (!toClose?.size) {
      return;
    }
    await Promise.all(
      [...toClose.values()].map((c) => c.disconnect().catch(() => undefined)),
    );
  }

  /**
   * Lists tools from every configured MCP client with names prefixed by a
   * slugified server config key (see {@link PrefixedMcpTool}).
   */
  public async listPrefixedTools(): Promise<Tool[]> {
    if (this.instances === null) {
      this.reload();
    }
    const map = this.instances!;
    const batches = await Promise.all(
      [...map.entries()].map(async ([server, client]) =>
        client
          .listTools()
          .then((tools) => tools.map((t) => new PrefixedMcpTool(server, t))),
      ),
    );
    return batches.flat();
  }

  /**
   * Collects optional server-level instructions from each connected MCP server.
   */
  public async listServerInstructions(): Promise<string[]> {
    if (this.instances === null) {
      this.reload();
    }
    const map = this.instances!;
    const rows = await Promise.all(
      [...map.entries()].map(async ([server, client]) => {
        await client.connect();
        const instructions = client.client.getInstructions()?.trim();
        if (!instructions) {
          return "";
        }

        return [`MCP server "${server}" instructions:`, "", instructions].join(
          "\n",
        );
      }),
    );
    return rows.filter(Boolean);
  }

  public async subscribeToChannels(
    channels: readonly string[],
    onMessage: (message: ChannelMessage) => void,
  ): Promise<() => void> {
    if (this.instances === null) {
      this.reload();
    }

    const map = this.instances!;
    const requested = [
      ...new Set(channels.map((c) => c.trim()).filter(Boolean)),
    ];
    if (requested.length === 0) {
      return () => {};
    }

    const unsubs: Array<() => void> = [];
    for (const [server, client] of map.entries()) {
      await client.connect();
      const experimental =
        client.client.getServerCapabilities()?.experimental ?? {};
      const user = readIdentityPath(experimental, "hooman/user");
      const session = readIdentityPath(experimental, "hooman/session");
      const thread = readIdentityPath(experimental, "hooman/thread");
      const supportsPermission =
        Boolean(get(experimental, [HOOMAN_CHANNEL_PERMISSION])) &&
        typeof (client.client as { setNotificationHandler?: unknown })
          .setNotificationHandler === "function";

      if (supportsPermission) {
        const schema = z.object({
          method: z.literal(HOOMAN_CHANNEL_PERMISSION_METHOD),
          params: z.object({
            request_id: z.string().min(1),
            behavior: z.enum(["allow_once", "allow_always", "deny"]),
          }),
        });
        const handler = (notification: {
          params?: {
            request_id?: string;
            behavior?: ChannelPermissionBehavior;
          };
        }) => {
          const requestId = notification.params?.request_id?.trim();
          const behavior = notification.params?.behavior;
          if (!requestId || !behavior) {
            return;
          }
          const key = `${server}:${requestId}`;
          const pending = this.pendingPermissions.get(key);
          if (!pending) {
            return;
          }
          this.pendingPermissions.delete(key);
          clearTimeout(pending.timer);
          pending.resolve(behavior);
        };
        client.client.setNotificationHandler(schema, handler);
        unsubs.push(() => {
          client.client.setNotificationHandler(schema, () => {});
        });
      }

      for (const channel of requested) {
        if (!Object.hasOwn(experimental, channel)) {
          continue;
        }

        const method = `notifications/${channel}`;
        const schema = z.object({
          method: z.literal(method),
          params: z.unknown().optional(),
        });
        const handler = (notification: {
          method: string;
          params?: unknown;
        }) => {
          const { method, params } = notification;
          const prompt = this.toChannelPrompt(method, params);
          if (!prompt) {
            return;
          }

          onMessage({
            prompt,
            meta: {
              server,
              channel,
              method,
              params,
              source: readSourceValue(params),
              identity: {
                user: readPathValue(params, user),
                session: readPathValue(params, session),
                thread: readPathValue(params, thread),
              },
            },
          });
        };
        client.client.setNotificationHandler(schema, handler);
        unsubs.push(() => {
          client.client.setNotificationHandler(schema, () => {});
        });
      }
    }

    return () => {
      for (const off of unsubs) {
        off();
      }
    };
  }

  public async supportsChannelPermission(server: string): Promise<boolean> {
    if (this.instances === null) {
      this.reload();
    }
    const client = this.instances!.get(server);
    if (!client) {
      return false;
    }
    await client.connect();
    const experimental =
      client.client.getServerCapabilities()?.experimental ?? {};
    return Boolean(get(experimental, [HOOMAN_CHANNEL_PERMISSION]));
  }

  public async requestChannelPermission(
    server: string,
    request: ChannelPermissionRequest,
    timeoutMs = 120_000,
  ): Promise<ChannelPermissionBehavior> {
    if (this.instances === null) {
      this.reload();
    }
    const client = this.instances!.get(server);
    if (!client) {
      throw new Error(`MCP server "${server}" is not connected.`);
    }
    await client.connect();
    const experimental =
      client.client.getServerCapabilities()?.experimental ?? {};
    if (!Object.hasOwn(experimental, HOOMAN_CHANNEL_PERMISSION)) {
      throw new Error(
        `MCP server "${server}" does not support ${HOOMAN_CHANNEL_PERMISSION}.`,
      );
    }

    const requestId = request.requestId.trim();
    if (!requestId) {
      throw new Error("requestId is required.");
    }
    const key = `${server}:${requestId}`;
    if (this.pendingPermissions.has(key)) {
      throw new Error(`Permission request "${requestId}" is already pending.`);
    }

    const response = new Promise<ChannelPermissionBehavior>(
      (resolve, reject) => {
        const timer = setTimeout(() => {
          this.pendingPermissions.delete(key);
          reject(
            new Error(
              `Permission request "${requestId}" timed out after ${timeoutMs}ms.`,
            ),
          );
        }, timeoutMs);
        this.pendingPermissions.set(key, { resolve, reject, timer });
      },
    );

    try {
      const sender = client.client as {
        notification?: (payload: unknown) => Promise<void>;
      };
      if (typeof sender.notification !== "function") {
        throw new Error(
          `MCP client for "${server}" cannot send notifications.`,
        );
      }
      await sender.notification({
        method: "notifications/hooman/channel/permission_request",
        params: {
          request_id: requestId,
          tool_name: request.tool,
          description: request.description,
          input_preview: request.preview,
          options: [
            { id: "allow_once", label: "Allow once" },
            { id: "allow_always", label: "Always allow" },
            { id: "deny", label: "Deny" },
          ],
          meta: {
            ...(request.source ? { source: request.source } : {}),
            ...(request.user ? { user: request.user } : {}),
            ...(request.session ? { session: request.session } : {}),
            ...(request.thread ? { thread: request.thread } : {}),
          },
        },
      });
      return await response;
    } catch (error) {
      const pending = this.pendingPermissions.get(key);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingPermissions.delete(key);
      }
      throw error;
    }
  }

  private toChannelPrompt(method: string, params?: unknown): string {
    if (
      params &&
      typeof params === "object" &&
      "content" in params &&
      typeof params.content === "string"
    ) {
      return params.content.trim();
    }

    try {
      return JSON.stringify(params).trim();
    } catch {
      return String(params).trim();
    }
  }
}
