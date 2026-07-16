import { McpClient } from "@strands-agents/sdk";
import { PrefixedMcpTool } from "./prefixed-mcp-tool.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import lodash from "lodash";
import { z } from "zod";
import { Config, type NamedMcpTransport } from "./config.js";
import { type McpOAuthService, createMcpOAuthService } from "./oauth/index.js";
import type { McpTransport, Sse, StreamableHttp } from "./types.js";
import { normalizeAttachmentPaths } from "../utils/attachments.js";

const { get } = lodash;

/**
 * Upper bound on how long a single MCP client disconnect may take before we
 * stop waiting for it. A wedged stdio child or a hung HTTP/SSE session close
 * must never block process shutdown.
 */
const DISCONNECT_TIMEOUT_MS = 3000;

/**
 * Resolves when `promise` settles or after `ms`, whichever comes first. The
 * timer is unref'd so it can never keep the event loop alive on its own.
 */
function withDisconnectTimeout(
  promise: Promise<unknown>,
  ms: number,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
    promise
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(timer);
        resolve();
      });
  });
}

export const HOOMAN_CHANNEL = "hooman/channel";
export const HOOMAN_CHANNEL_PERMISSION = "hooman/channel/permission";
const HOOMAN_CHANNEL_PERMISSION_METHOD = `notifications/${HOOMAN_CHANNEL_PERMISSION}`;
export const HOOMAN_CHANNEL_ASK = "hooman/channel/ask";
const HOOMAN_CHANNEL_ASK_METHOD = `notifications/${HOOMAN_CHANNEL_ASK}`;

export type ChannelMessageMeta = {
  subscription: ChannelSubscription;
  source?: string;
  user?: string;
  session?: string;
  thread?: string;
};

export type ChannelMessage = {
  prompt: string;
  attachments: string[];
  meta: ChannelMessageMeta;
};

export type ChannelPermissionBehavior = "allow_once" | "allow_always" | "deny";

export type ChannelSubscription = {
  server: string;
  channel: string;
};

export type ChannelSubscriptionHandle = {
  unsubscribe: () => void;
  subscriptions: ChannelSubscription[];
};

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

export type ChannelAskOutcome =
  { kind: "answered"; answer: string } | { kind: "dismissed" };

type ChannelAskRequest = {
  requestId: string;
  question: string;
  options: string[];
  source?: string;
  user?: string;
  session?: string;
  thread?: string;
};

export type ServerAuthStatus = {
  name: string;
  transportType: McpTransport["type"];
  status: "unsupported" | "authenticated" | "expired" | "unauthenticated";
};

function isOAuthRemoteTransport(
  transport: McpTransport,
): transport is StreamableHttp | Sse {
  if (transport.type !== "streamable-http" && transport.type !== "sse") {
    return false;
  }
  // A remote server that authenticates with a static Authorization header and
  // has no OAuth config is not an OAuth server. The SDK only invokes the OAuth
  // flow on a 401, so such servers never store tokens — reporting them as
  // "unauthenticated" would wrongly trip the status-bar "needs attention" flag.
  if (transport.oauth) {
    return true;
  }
  const hasAuthHeader = Object.keys(transport.headers ?? {}).some(
    (key) => key.toLowerCase() === "authorization",
  );
  return !hasAuthHeader;
}

function transportFor(
  name: string,
  spec: McpTransport,
  oauth: McpOAuthService,
): Transport {
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
        authProvider: oauth.getProvider(name, spec),
        requestInit: headers ? { headers } : undefined,
      });
    }
    case "sse": {
      const headers = spec.headers;
      return new SSEClientTransport(new URL(spec.url), {
        authProvider: oauth.getProvider(name, spec),
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

function readAttachmentsFromParams(params: unknown): string[] {
  if (!params || typeof params !== "object") {
    return [];
  }
  const topLevel = (params as { attachments?: unknown }).attachments;
  return normalizeAttachmentPaths(topLevel);
}

/**
 * Holds one {@link McpClient} per named entry in {@link Config}. Call {@link reload}
 * after changing the file on disk (or construct and then {@link reload} once).
 */
export class Manager {
  private instances: Map<string, McpClient> | null = null;
  private readonly oauth: McpOAuthService;
  private readonly permissions = new Map<
    string,
    {
      resolve: (behavior: ChannelPermissionBehavior) => void;
      reject: (reason: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly asks = new Map<
    string,
    {
      resolve: (outcome: ChannelAskOutcome) => void;
      reject: (reason: Error) => void;
      timer: ReturnType<typeof setTimeout>;
      /** Answer choices offered, for mapping an `option_id` reply to its label. */
      options: string[];
    }
  >();

  public constructor(
    private readonly config: Config,
    private readonly acp = false,
    private readonly servers: readonly NamedMcpTransport[] = [],
    oauth: McpOAuthService = createMcpOAuthService(),
  ) {
    this.oauth = oauth;
  }

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
    if (!this.acp) {
      this.config.reload();
    }
    const previous = this.instances;
    const next = new Map<string, McpClient>();
    const transports = [
      ...(this.acp ? [] : this.config.list()),
      // Session-scoped servers override local config entries on name conflicts.
      ...this.servers,
    ];
    for (const { name, transport } of transports) {
      next.set(
        name,
        new McpClient({
          transport: transportFor(name, transport, this.oauth),
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
    for (const [key, pending] of this.permissions.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Pending permission "${key}" cancelled.`));
    }
    this.permissions.clear();
    for (const [key, pending] of this.asks.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Pending question "${key}" cancelled.`));
    }
    this.asks.clear();
    const toClose = this.instances;
    this.instances = null;
    if (!toClose?.size) {
      return;
    }
    // Bound each client disconnect so a wedged transport cannot block shutdown.
    await Promise.all(
      [...toClose.values()].map((c) =>
        withDisconnectTimeout(c.disconnect(), DISCONNECT_TIMEOUT_MS),
      ),
    );
  }

  public listServers(): NamedMcpTransport[] {
    if (!this.acp) {
      this.config.reload();
    }
    const combined = new Map<string, McpTransport>();
    const configured = this.acp ? [] : this.config.list();
    for (const { name, transport } of configured) {
      combined.set(name, transport);
    }
    for (const { name, transport } of this.servers) {
      combined.set(name, transport);
    }
    return [...combined.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, transport]) => ({ name, transport }));
  }

  public getServer(name: string): NamedMcpTransport | undefined {
    return this.listServers().find((entry) => entry.name === name);
  }

  public async authenticate(name: string): Promise<void> {
    const server = this.getServer(name);
    if (!server) {
      throw new Error(`MCP server "${name}" does not exist.`);
    }
    if (!isOAuthRemoteTransport(server.transport)) {
      throw new Error(`MCP server "${name}" is not a remote HTTP/SSE server.`);
    }
    await this.oauth.authenticate(name, server.transport);
    this.reload();
  }

  public async logout(
    name: string,
    scope: "all" | "client" | "tokens" | "discovery" = "all",
  ): Promise<void> {
    const server = this.getServer(name);
    if (!server) {
      throw new Error(`MCP server "${name}" does not exist.`);
    }
    if (!isOAuthRemoteTransport(server.transport)) {
      throw new Error(`MCP server "${name}" is not a remote HTTP/SSE server.`);
    }
    await this.oauth.logout(name, server.transport, scope);
    this.reload();
  }

  public async listAuthStatuses(): Promise<ServerAuthStatus[]> {
    const servers = this.listServers();
    const rows = await Promise.all(
      servers.map(async ({ name, transport }) => {
        if (!isOAuthRemoteTransport(transport)) {
          return {
            name,
            transportType: transport.type,
            status: "unsupported" as const,
          };
        }
        const status = await this.oauth.status(name, transport);
        return {
          name,
          transportType: transport.type,
          status,
        };
      }),
    );
    return rows;
  }

  /** The already-connected client for `name`, connecting it if needed. Never opens a second connection. */
  private async requireConnectedClient(name: string): Promise<McpClient> {
    if (this.instances === null) {
      this.reload();
    }
    const client = this.instances!.get(name);
    if (!client) {
      throw new Error(`MCP server "${name}" is not configured.`);
    }
    await client.connect();
    return client;
  }

  /**
   * Raw MCP `tools/list` for one configured server, forwarded over its
   * single already-connected client. Used by the daemon's local MCP tool
   * proxy so daemon-hosted ACP sessions never open a second connection to a
   * server the daemon already holds open for channel notifications.
   */
  public async listServerTools(name: string): Promise<Tool[]> {
    const client = await this.requireConnectedClient(name);
    const wire = await client.client.listTools();
    return wire.tools;
  }

  /** Raw MCP `tools/call` for one configured server's single already-connected client. */
  public async callServerTool(
    name: string,
    params: { name: string; arguments?: Record<string, unknown> },
    signal?: AbortSignal,
  ): Promise<CallToolResult> {
    const client = await this.requireConnectedClient(name);
    return client.client.callTool(
      params,
      undefined,
      signal ? { signal } : undefined,
    ) as Promise<CallToolResult>;
  }

  /**
   * Lists tools from every configured MCP client with names prefixed by a
   * slugified server config key (see {@link PrefixedMcpTool}).
   */
  public async listPrefixedTools(): Promise<PrefixedMcpTool[]> {
    if (this.instances === null) {
      this.reload();
    }
    const map = this.instances!;
    const batches = await Promise.all(
      [...map.entries()].map(async ([server, client]) => {
        try {
          await client.connect();
          const wire = await client.client.listTools();
          const readOnly = new Map(
            wire.tools.map((t) => [
              t.name,
              t.annotations?.readOnlyHint === true,
            ]),
          );
          const strandsTools = await client.listTools();
          return strandsTools.map(
            (t) =>
              new PrefixedMcpTool(server, t, readOnly.get(t.name) === true),
          );
        } catch (error) {
          if (error instanceof UnauthorizedError) {
            return [];
          }
          return [];
        }
      }),
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
        const connected = await client
          .connect()
          .then(() => true)
          .catch(() => false);
        if (!connected) {
          return "";
        }
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
  ): Promise<ChannelSubscriptionHandle> {
    if (this.instances === null) {
      this.reload();
    }

    const map = this.instances!;
    const requested = [
      ...new Set(channels.map((c) => c.trim()).filter(Boolean)),
    ];
    if (requested.length === 0) {
      return { unsubscribe: () => {}, subscriptions: [] };
    }

    const unsubs: Array<() => void> = [];
    const subscriptions: ChannelSubscription[] = [];
    for (const [server, client] of map.entries()) {
      const connected = await client
        .connect()
        .then(() => true)
        .catch(() => false);
      if (!connected) {
        continue;
      }
      const experimental =
        client.client.getServerCapabilities()?.experimental ?? {};
      const user = readIdentityPath(experimental, "hooman/user");
      const session = readIdentityPath(experimental, "hooman/session");
      const thread = readIdentityPath(experimental, "hooman/thread");
      const canHandleNotifications =
        typeof (client.client as { setNotificationHandler?: unknown })
          .setNotificationHandler === "function";
      const supportsPermission =
        Boolean(get(experimental, [HOOMAN_CHANNEL_PERMISSION])) &&
        canHandleNotifications;
      const supportsAsk =
        Boolean(get(experimental, [HOOMAN_CHANNEL_ASK])) &&
        canHandleNotifications;

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
          const pending = this.permissions.get(key);
          if (!pending) {
            return;
          }
          this.permissions.delete(key);
          clearTimeout(pending.timer);
          pending.resolve(behavior);
        };
        client.client.setNotificationHandler(schema, handler);
        unsubs.push(() => {
          client.client.setNotificationHandler(schema, () => {});
        });
      }

      if (supportsAsk) {
        const schema = z.object({
          method: z.literal(HOOMAN_CHANNEL_ASK_METHOD),
          params: z.object({
            request_id: z.string().min(1),
            option_id: z.string().optional(),
            answer: z.string().optional(),
            dismissed: z.boolean().optional(),
          }),
        });
        const handler = (notification: {
          params?: {
            request_id?: string;
            option_id?: string;
            answer?: string;
            dismissed?: boolean;
          };
        }) => {
          const requestId = notification.params?.request_id?.trim();
          if (!requestId) {
            return;
          }
          const key = `${server}:${requestId}`;
          const pending = this.asks.get(key);
          if (!pending) {
            return;
          }
          this.asks.delete(key);
          clearTimeout(pending.timer);
          if (notification.params?.dismissed) {
            pending.resolve({ kind: "dismissed" });
            return;
          }
          const optionId = notification.params?.option_id?.trim();
          if (optionId) {
            const index = Number.parseInt(optionId.replace("answer_", ""), 10);
            const label = pending.options[index];
            if (label !== undefined) {
              pending.resolve({ kind: "answered", answer: label });
              return;
            }
          }
          const answer = notification.params?.answer?.trim();
          if (answer) {
            pending.resolve({ kind: "answered", answer });
          } else {
            pending.resolve({ kind: "dismissed" });
          }
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

        subscriptions.push({ server, channel });

        const method = `notifications/${channel}`;
        const schema = z.object({
          method: z.literal(method),
          params: z.unknown().optional(),
        });
        const handler = (notification: {
          method: string;
          params?: unknown;
        }) => {
          const { params } = notification;
          const prompt = this.toChannelPrompt(params);
          if (!prompt) {
            return;
          }
          const attachments = readAttachmentsFromParams(params);

          onMessage({
            prompt,
            attachments,
            meta: {
              subscription: { server, channel },
              source: readSourceValue(params),
              user: readPathValue(params, user),
              session: readPathValue(params, session),
              thread: readPathValue(params, thread),
            },
          });
        };
        client.client.setNotificationHandler(schema, handler);
        unsubs.push(() => {
          client.client.setNotificationHandler(schema, () => {});
        });
      }
    }

    return {
      subscriptions,
      unsubscribe: () => {
        for (const off of unsubs) {
          off();
        }
      },
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
    const connected = await client
      .connect()
      .then(() => true)
      .catch(() => false);
    if (!connected) {
      return false;
    }
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
    if (this.permissions.has(key)) {
      throw new Error(`Permission request "${requestId}" is already pending.`);
    }

    const response = new Promise<ChannelPermissionBehavior>(
      (resolve, reject) => {
        const timer = setTimeout(() => {
          this.permissions.delete(key);
          reject(
            new Error(
              `Permission request "${requestId}" timed out after ${timeoutMs}ms.`,
            ),
          );
        }, timeoutMs);
        this.permissions.set(key, { resolve, reject, timer });
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
      const pending = this.permissions.get(key);
      if (pending) {
        clearTimeout(pending.timer);
        this.permissions.delete(key);
      }
      throw error;
    }
  }

  public async supportsChannelAsk(server: string): Promise<boolean> {
    if (this.instances === null) {
      this.reload();
    }
    const client = this.instances!.get(server);
    if (!client) {
      return false;
    }
    const connected = await client
      .connect()
      .then(() => true)
      .catch(() => false);
    if (!connected) {
      return false;
    }
    const experimental =
      client.client.getServerCapabilities()?.experimental ?? {};
    return Boolean(get(experimental, [HOOMAN_CHANNEL_ASK]));
  }

  /**
   * Relays an `ask_user` question to the channel's MCP server over the
   * `hooman/channel/ask` capability and waits for the user's answer (or a
   * dismissal) to come back as a `notifications/hooman/channel/ask`
   * notification. Mirrors {@link requestChannelPermission}.
   */
  public async requestChannelAsk(
    server: string,
    request: ChannelAskRequest,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<ChannelAskOutcome> {
    const timeoutMs = options.timeoutMs ?? 120_000;
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
    if (!Object.hasOwn(experimental, HOOMAN_CHANNEL_ASK)) {
      throw new Error(
        `MCP server "${server}" does not support ${HOOMAN_CHANNEL_ASK}.`,
      );
    }

    const requestId = request.requestId.trim();
    if (!requestId) {
      throw new Error("requestId is required.");
    }
    const key = `${server}:${requestId}`;
    if (this.asks.has(key)) {
      throw new Error(`Ask request "${requestId}" is already pending.`);
    }

    let onAbort: (() => void) | undefined;
    const response = new Promise<ChannelAskOutcome>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.asks.delete(key);
        reject(
          new Error(
            `Ask request "${requestId}" timed out after ${timeoutMs}ms.`,
          ),
        );
      }, timeoutMs);
      this.asks.set(key, {
        resolve,
        reject,
        timer,
        options: [...request.options],
      });
      if (options.signal) {
        onAbort = () => {
          const pending = this.asks.get(key);
          if (!pending) {
            return;
          }
          this.asks.delete(key);
          clearTimeout(pending.timer);
          // Cancelled turn: treat as a dismissal, not an error.
          pending.resolve({ kind: "dismissed" });
        };
        options.signal.addEventListener("abort", onAbort, { once: true });
      }
    });

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
        method: "notifications/hooman/channel/ask_request",
        params: {
          request_id: requestId,
          question: request.question,
          options: request.options.map((option, index) => ({
            id: `answer_${index}`,
            label: option,
          })),
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
      const pending = this.asks.get(key);
      if (pending) {
        clearTimeout(pending.timer);
        this.asks.delete(key);
      }
      throw error;
    } finally {
      if (onAbort) {
        options.signal?.removeEventListener("abort", onAbort);
      }
    }
  }

  private toChannelPrompt(params?: unknown): string {
    const parts = [];

    if (
      params &&
      typeof params === "object" &&
      "content" in params &&
      typeof params.content === "string"
    ) {
      parts.push(params.content.trim());
    }

    if (
      params &&
      typeof params === "object" &&
      "attachments" in params &&
      Array.isArray(params.attachments) &&
      params.attachments.length > 0
    ) {
      parts.push("User sent attachments.");
    }

    if (
      params &&
      typeof params === "object" &&
      "event" in params &&
      typeof params.event === "object"
    ) {
      parts.push(
        "Raw event data:\n```json\n" + JSON.stringify(params.event) + "\n```",
      );
    }

    return parts.filter(Boolean).join("\n").trim();
  }
}
