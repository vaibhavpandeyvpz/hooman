import { useState, useEffect, forwardRef, useImperativeHandle } from "react";
import { FileUp, Pencil, Plus, Trash2 } from "lucide-react";
import { useDialog } from "./Dialog";
import { Button } from "./Button";
import { Input } from "./Input";
import { Modal } from "./Modal";
import { Textarea } from "./Textarea";
import { Checkbox } from "./Checkbox";
import { Select } from "./Select";
import type {
  MCPConnection,
  MCPConnectionHosted,
  MCPConnectionStreamableHttp,
  MCPConnectionStdio,
} from "../types";
import {
  getMCPConnections,
  getSystemMCPConnections,
  createMCPConnection,
  updateMCPConnection,
  deleteMCPConnection,
  getOAuthCallbackUrl,
  startMCPOAuth,
  saveConfig,
  reloadMcpTools,
} from "../api";
import type { SystemMcpEntry } from "../api";

const CONNECTION_TYPE_OPTIONS: {
  value: MCPConnection["type"];
  label: string;
}[] = [
  { value: "hosted", label: "Hosted MCP" },
  { value: "streamable_http", label: "Streamable HTTP" },
  { value: "stdio", label: "Stdio (local process)" },
];

function connectionLabel(c: MCPConnection): string {
  if (c.type === "hosted") return c.server_label || c.id;
  if (c.type === "streamable_http") return c.name || c.id;
  return c.name || c.id;
}

function connectionTypeBadge(c: MCPConnection): string {
  if (c.type === "hosted") return "Hosted";
  if (c.type === "streamable_http") return "HTTP";
  return "Stdio";
}

/** Import JSON shape: { mcpServers: { [name]: { command?, args?, env?, cwd? } | { url, headers?, auth? } } } */
type ImportServerEntry = {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  auth?: {
    client_id?: string;
    client_secret?: string;
    /** Fallback: app callback URL. */
    redirect_uri?: string;
    scope?: string;
    scopes?: string[];
    authorization_server_url?: string;
  };
};

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function uniqueId(baseId: string, existingIds: Set<string>): string {
  let id = baseId || "imported";
  let n = 1;
  while (existingIds.has(id)) {
    id = `${baseId || "imported"}-${n}`;
    n += 1;
  }
  existingIds.add(id);
  return id;
}

function parseImportJson(
  raw: string,
  existingIds: Set<string>,
  oauthRedirectUri: string,
): { connections: MCPConnection[]; error?: string } {
  try {
    const data = JSON.parse(raw) as {
      mcpServers?: Record<string, ImportServerEntry>;
    };
    const servers = data?.mcpServers;
    if (!servers || typeof servers !== "object") {
      return {
        connections: [],
        error:
          "JSON must have an object 'mcpServers' with server names as keys.",
      };
    }
    const connections: MCPConnection[] = [];
    const usedIds = new Set(existingIds);
    for (const [name, entry] of Object.entries(servers)) {
      if (!entry || typeof entry !== "object") continue;
      const hasCommand =
        typeof (entry as ImportServerEntry).command === "string";
      const hasUrl = typeof (entry as ImportServerEntry).url === "string";
      if (hasCommand) {
        const e = entry as ImportServerEntry;
        const id = uniqueId(slug(name), usedIds);
        const conn: MCPConnectionStdio = {
          id,
          type: "stdio",
          name: name,
          command: String(e.command ?? ""),
          args: Array.isArray(e.args) ? e.args.map(String) : [],
          env:
            e.env && typeof e.env === "object"
              ? (e.env as Record<string, string>)
              : undefined,
          cwd: typeof e.cwd === "string" ? e.cwd : undefined,
          enabled: true,
        };
        connections.push(conn);
      } else if (hasUrl) {
        const e = entry as ImportServerEntry;
        const id = uniqueId(slug(name), usedIds);
        const headers =
          e.headers && typeof e.headers === "object" ? e.headers : undefined;
        const auth = e.auth && typeof e.auth === "object" ? e.auth : undefined;
        const hasOAuth =
          auth &&
          (auth.client_id ||
            auth.client_secret ||
            auth.redirect_uri ||
            auth.scope ||
            (Array.isArray(auth.scopes) && auth.scopes.length > 0) ||
            auth.authorization_server_url);
        const redirectUri =
          (auth?.redirect_uri ?? "").trim() || oauthRedirectUri;
        const scopeStr = [
          auth?.scope,
          Array.isArray(auth?.scopes) && auth.scopes.length > 0
            ? auth.scopes.join(" ")
            : "",
        ]
          .filter(Boolean)
          .join(" ")
          .trim();
        const oauth = hasOAuth
          ? {
              redirect_uri: redirectUri,
              ...(auth!.client_id && {
                client_id: String(auth!.client_id).trim(),
              }),
              ...(auth!.client_secret && {
                client_secret: String(auth!.client_secret).trim(),
              }),
              ...(scopeStr && { scope: scopeStr }),
              ...(auth!.authorization_server_url && {
                authorization_server_url: String(
                  auth!.authorization_server_url,
                ).trim(),
              }),
            }
          : undefined;
        const conn: MCPConnectionStreamableHttp = {
          id,
          type: "streamable_http",
          name,
          url: String(e.url),
          headers: headers ?? undefined,
          oauth: oauth ?? undefined,
          enabled: true,
        };
        connections.push(conn);
      }
    }
    if (connections.length === 0) {
      return {
        connections: [],
        error:
          "No valid servers found. Each entry needs 'command' (and optional args/env/cwd) or 'url' (and optional headers/auth).",
      };
    }
    return { connections };
  } catch (e) {
    return {
      connections: [],
      error: e instanceof SyntaxError ? "Invalid JSON." : (e as Error).message,
    };
  }
}

export interface McpConnectionsHandle {
  startAdd: () => void;
  startImport: () => void;
}

export interface McpConnectionsProps {
  /** Called after add/update/remove/toggle so Tools tab can refresh. */
  onConnectionsChange?: () => void | Promise<void>;
}

export const McpConnections = forwardRef<
  McpConnectionsHandle,
  McpConnectionsProps
>(function McpConnections({ onConnectionsChange }, ref) {
  useImperativeHandle(ref, () => ({ startAdd, startImport }));
  const dialog = useDialog();
  const [connections, setConnections] = useState<MCPConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<Partial<MCPConnection>>({});
  const [argsRaw, setArgsRaw] = useState("");
  const [allowedToolsRaw, setAllowedToolsRaw] = useState("");
  const [blockedToolsRaw, setBlockedToolsRaw] = useState("");
  const [envEntries, setEnvEntries] = useState<
    { key: string; value: string }[]
  >([]);
  const [bearerToken, setBearerToken] = useState("");
  const [headerEntries, setHeaderEntries] = useState<
    { key: string; value: string }[]
  >([]);
  const [oauthCallbackUrl, setOAuthCallbackUrl] = useState("");
  const [oauthEnabled, setOAuthEnabled] = useState(false);
  const [oauthRedirectUri, setOAuthRedirectUri] = useState("");
  const [oauthClientId, setOAuthClientId] = useState("");
  const [oauthClientSecret, setOAuthClientSecret] = useState("");
  const [oauthScope, setOAuthScope] = useState("");
  const [oauthAuthServerUrl, setOAuthAuthServerUrl] = useState("");
  const [oauthStartingId, setOAuthStartingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [systemConnections, setSystemConnections] = useState<SystemMcpEntry[]>(
    [],
  );
  const [togglingSystemId, setTogglingSystemId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importJson, setImportJson] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  function buildHeaders(): Record<string, string> | undefined {
    const custom = headerEntries
      .filter((e) => e.key.trim() !== "")
      .reduce(
        (acc, e) => ({ ...acc, [e.key.trim()]: e.value }),
        {} as Record<string, string>,
      );
    const withAuth =
      bearerToken && bearerToken !== "***"
        ? { ...custom, Authorization: `Bearer ${bearerToken}` }
        : custom;
    if (Object.keys(withAuth).length === 0) return undefined;
    return withAuth;
  }

  function load() {
    setLoading(true);
    setError(null);
    Promise.all([getMCPConnections(), getSystemMCPConnections()])
      .then(([connRes, sysRes]) => {
        setConnections(connRes.connections ?? []);
        setSystemConnections(sysRes.systemConnections ?? []);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }

  async function toggleSystemMcp(entry: SystemMcpEntry) {
    setTogglingSystemId(entry.id);
    setError(null);
    try {
      const currentEnabled = systemConnections
        .filter((s) => s.enabled)
        .map((s) => s.name);
      const newEnabled = entry.enabled
        ? currentEnabled.filter((n) => n !== entry.name)
        : [...currentEnabled, entry.name];
      await saveConfig({ SYSTEM_MCP_SERVERS: newEnabled.join(",") });
      const res = await getSystemMCPConnections();
      setSystemConnections(res.systemConnections ?? []);
      await reloadMcpTools();
      await onConnectionsChange?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTogglingSystemId(null);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (
      editing !== null &&
      (form.type === "hosted" || form.type === "streamable_http") &&
      !oauthCallbackUrl
    ) {
      getOAuthCallbackUrl()
        .then((r) => setOAuthCallbackUrl(r.callbackUrl))
        .catch(() => {});
    }
  }, [editing, form.type, oauthCallbackUrl]);

  function startAdd() {
    setEditing("new");
    setArgsRaw("");
    setEnvEntries([]);
    setBearerToken("");
    setHeaderEntries([]);
    setOAuthEnabled(false);
    setOAuthRedirectUri("");
    setOAuthClientId("");
    setOAuthClientSecret("");
    setOAuthScope("");
    setOAuthAuthServerUrl("");
    setAllowedToolsRaw("");
    setBlockedToolsRaw("");
    setForm({
      type: "hosted",
      server_label: "",
      allowedToolNames: [],
      blockedToolNames: [],
    });
  }

  function startImport() {
    setImportOpen(true);
    setImportJson("");
    setImportError(null);
  }

  async function handleImportSubmit() {
    setImportError(null);
    const existingIds = new Set(connections.map((c) => c.id));
    let redirectUri = "";
    try {
      redirectUri = (await getOAuthCallbackUrl()).callbackUrl;
    } catch {
      // use empty; OAuth imports may need user to set redirect in edit
    }
    const result = parseImportJson(importJson, existingIds, redirectUri);
    if (result.error) {
      setImportError(result.error);
      return;
    }
    setImporting(true);
    try {
      for (const conn of result.connections) {
        await createMCPConnection(conn);
      }
      setImportOpen(false);
      setImportJson("");
      load();
      await onConnectionsChange?.();
      await reloadMcpTools();
    } catch (e) {
      setImportError((e as Error).message);
    } finally {
      setImporting(false);
    }
  }

  function startEdit(c: MCPConnection) {
    setEditing(c.id);
    setForm({ ...c });
    setAllowedToolsRaw((c.allowedToolNames ?? []).join(", "));
    setBlockedToolsRaw((c.blockedToolNames ?? []).join(", "));
    if (c.type === "stdio") {
      setArgsRaw(Array.isArray(c.args) ? c.args.join(", ") : "");
      setEnvEntries(
        c.env && typeof c.env === "object"
          ? Object.entries(c.env).map(([key, value]) => ({ key, value }))
          : [],
      );
      setBearerToken("");
      setHeaderEntries([]);
    } else if (c.type === "streamable_http" || c.type === "hosted") {
      const headers = c.headers ?? {};
      const auth = headers.Authorization ?? "";
      setBearerToken(auth.replace(/^Bearer\s+/i, "") || "");
      const rest = Object.entries(headers)
        .filter(([k]) => k !== "Authorization")
        .map(([key, value]) => ({ key, value }));
      setHeaderEntries(rest);
      const o = (c as MCPConnectionHosted | MCPConnectionStreamableHttp).oauth;
      setOAuthEnabled(!!o);
      setOAuthRedirectUri(o?.redirect_uri ?? "");
      setOAuthClientId(o?.client_id ?? "");
      setOAuthClientSecret(
        o?.client_secret === "***" ? "***" : (o?.client_secret ?? ""),
      );
      setOAuthScope(o?.scope ?? "");
      setOAuthAuthServerUrl(o?.authorization_server_url ?? "");
    } else {
      setEnvEntries([]);
      setBearerToken("");
      setHeaderEntries([]);
      setOAuthEnabled(false);
      setOAuthRedirectUri("");
      setOAuthClientId("");
      setOAuthClientSecret("");
      setOAuthScope("");
      setOAuthAuthServerUrl("");
    }
  }

  async function save() {
    if (!form.type) {
      setError("Select a connection type.");
      return;
    }
    setError(null);
    try {
      const base = { id: form.id || crypto.randomUUID(), type: form.type };
      const allowedToolNames = allowedToolsRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const blockedToolNames = blockedToolsRaw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (
        (form.type === "hosted" || form.type === "streamable_http") &&
        oauthEnabled &&
        !oauthRedirectUri.trim() &&
        !oauthCallbackUrl
      ) {
        setError("Redirect URI is required for OAuth. Loading callback URL…");
        return;
      }
      if (form.type === "hosted") {
        if (!form.server_url?.trim()) {
          setError("Server URL is required for hosted MCP.");
          return;
        }
        let headers = buildHeaders();
        if (
          editing !== "new" &&
          bearerToken === "***" &&
          (form.headers?.Authorization ?? "").startsWith("Bearer ")
        ) {
          headers = { ...headers, Authorization: "Bearer ***" };
        }
        const conn: MCPConnectionHosted = {
          ...base,
          type: "hosted",
          server_label: form.server_label ?? "",
          server_url: form.server_url.trim(),
          allowedToolNames:
            allowedToolNames.length > 0 ? allowedToolNames : undefined,
          blockedToolNames:
            blockedToolNames.length > 0 ? blockedToolNames : undefined,
          headers,
          ...(oauthEnabled && {
            oauth: {
              redirect_uri: oauthRedirectUri.trim() || oauthCallbackUrl,
              ...(oauthClientId.trim() && {
                client_id: oauthClientId.trim(),
              }),
              ...(oauthClientSecret &&
                oauthClientSecret !== "***" && {
                  client_secret: oauthClientSecret,
                }),
              ...(editing !== "new" &&
                oauthClientSecret === "***" && { client_secret: "***" }),
              ...(oauthScope.trim() && { scope: oauthScope.trim() }),
              ...(oauthAuthServerUrl.trim() && {
                authorization_server_url: oauthAuthServerUrl.trim(),
              }),
            },
          }),
          ...(editing !== "new" && { enabled: form.enabled !== false }),
        };
        if (editing === "new") await createMCPConnection(conn);
        else await updateMCPConnection(conn.id, conn);
      } else if (form.type === "streamable_http") {
        let headers = buildHeaders();
        if (
          editing !== "new" &&
          bearerToken === "***" &&
          (form.headers?.Authorization ?? "").startsWith("Bearer ")
        ) {
          headers = { ...headers, Authorization: "Bearer ***" };
        }
        const conn: MCPConnectionStreamableHttp = {
          ...base,
          type: "streamable_http",
          name: form.name ?? "",
          url: form.url ?? "",
          allowedToolNames:
            allowedToolNames.length > 0 ? allowedToolNames : undefined,
          blockedToolNames:
            blockedToolNames.length > 0 ? blockedToolNames : undefined,
          headers,
          timeout_seconds: form.timeout_seconds,
          cache_tools_list: form.cache_tools_list ?? true,
          max_retry_attempts: form.max_retry_attempts,
          ...(oauthEnabled && {
            oauth: {
              redirect_uri: oauthRedirectUri.trim() || oauthCallbackUrl,
              ...(oauthClientId.trim() && {
                client_id: oauthClientId.trim(),
              }),
              ...(oauthClientSecret &&
                oauthClientSecret !== "***" && {
                  client_secret: oauthClientSecret,
                }),
              ...(editing !== "new" &&
                oauthClientSecret === "***" && { client_secret: "***" }),
              ...(oauthScope.trim() && { scope: oauthScope.trim() }),
              ...(oauthAuthServerUrl.trim() && {
                authorization_server_url: oauthAuthServerUrl.trim(),
              }),
            },
          }),
          ...(editing !== "new" && { enabled: form.enabled !== false }),
        };
        if (editing === "new") await createMCPConnection(conn);
        else await updateMCPConnection(conn.id, conn);
      } else if (form.type === "stdio") {
        const env =
          envEntries.length > 0
            ? envEntries
                .filter((e) => e.key.trim() !== "")
                .reduce(
                  (acc, e) => ({ ...acc, [e.key.trim()]: e.value }),
                  {} as Record<string, string>,
                )
            : undefined;
        const conn: MCPConnectionStdio = {
          ...base,
          type: "stdio",
          name: form.name ?? "",
          command: form.command ?? "",
          args: argsRaw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
          allowedToolNames:
            allowedToolNames.length > 0 ? allowedToolNames : undefined,
          blockedToolNames:
            blockedToolNames.length > 0 ? blockedToolNames : undefined,
          ...(Object.keys(env ?? {}).length > 0 ? { env } : {}),
          ...(form.cwd?.trim() ? { cwd: form.cwd.trim() } : {}),
          ...(editing !== "new" && { enabled: form.enabled !== false }),
        };
        if (editing === "new") await createMCPConnection(conn);
        else await updateMCPConnection(conn.id, conn);
      }
      setEditing(null);
      load();
      await onConnectionsChange?.();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove(id: string) {
    const ok = await dialog.confirm({
      title: "Remove MCP server",
      message: "Remove this MCP server?",
      confirmLabel: "Remove",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await deleteMCPConnection(id);
      setEditing(null);
      load();
      await onConnectionsChange?.();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (loading && connections.length === 0) {
    return <div className="text-hooman-muted">Loading MCP connections…</div>;
  }

  return (
    <>
      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "New MCP server" : "Edit MCP server"}
        maxWidth="2xl"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              <Button variant="success" onClick={save}>
                Save
              </Button>
              <Button variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
            </div>
            <a
              href="https://smithery.ai/servers"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-hooman-border bg-hooman-surface px-3 py-2 text-sm text-[#FF5601] hover:bg-[#FF5601]/10 hover:text-[#FF5601] focus:outline-none focus:ring-2 focus:ring-[#FF5601]/50 focus:ring-offset-2 focus:ring-offset-hooman-bg"
            >
              <img
                src="/smithery-logo.svg"
                alt=""
                className="h-4 w-auto"
                width={34}
                height={40}
              />
              Find on Smithery
            </a>
          </div>
        }
      >
        {error && (
          <div className="mb-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-2 text-sm">
            {error}
          </div>
        )}
        <div className="space-y-3">
          <Select<MCPConnection["type"]>
            label="Type"
            value={form.type ?? "hosted"}
            options={CONNECTION_TYPE_OPTIONS}
            onChange={(type) => {
              setAllowedToolsRaw("");
              setBlockedToolsRaw("");
              if (type === "stdio") {
                setArgsRaw("");
                setEnvEntries([]);
                setOAuthEnabled(false);
                setOAuthRedirectUri("");
                setOAuthClientId("");
                setOAuthClientSecret("");
                setOAuthScope("");
                setOAuthAuthServerUrl("");
              }
              setBearerToken("");
              setHeaderEntries([]);
              setForm((f) => ({
                ...f,
                type,
                allowedToolNames: [],
                blockedToolNames: [],
                ...(type === "hosted"
                  ? { server_label: "" }
                  : type === "streamable_http"
                    ? { name: "", url: "", cache_tools_list: true }
                    : {
                        name: "",
                        command: "",
                        args: [],
                        env: undefined,
                        cwd: undefined,
                      }),
              }));
            }}
          />
          {form.type === "hosted" && (
            <>
              <Input
                label="Server label"
                placeholder="e.g. gitmcp"
                value={form.server_label ?? ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, server_label: e.target.value }))
                }
              />
              <Input
                label="Server URL"
                placeholder="https://gitmcp.io/openai/codex"
                value={form.server_url ?? ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, server_url: e.target.value }))
                }
              />
              <Checkbox
                id="hosted-oauth"
                label="Use OAuth (PKCE, optional DCR)"
                checked={oauthEnabled}
                onChange={(checked) => setOAuthEnabled(checked)}
              />
              {oauthEnabled && (
                <div className="space-y-2 rounded-lg border border-hooman-border p-3 bg-hooman-bg/50">
                  <Input
                    label="Authorization server URL (optional)"
                    placeholder="Override when discovery from MCP URL is not used"
                    value={oauthAuthServerUrl}
                    onChange={(e) => setOAuthAuthServerUrl(e.target.value)}
                  />
                  <Input
                    label="Client ID (optional; leave empty for DCR)"
                    placeholder="Pre-registered client or leave empty for dynamic registration"
                    value={oauthClientId}
                    onChange={(e) => setOAuthClientId(e.target.value)}
                  />
                  <Input
                    label="Client secret (optional)"
                    placeholder="For confidential clients"
                    type="password"
                    value={oauthClientSecret}
                    onChange={(e) => setOAuthClientSecret(e.target.value)}
                    autoComplete="off"
                  />
                  <Input
                    label="Redirect URI"
                    placeholder="Callback URL"
                    value={oauthRedirectUri || oauthCallbackUrl}
                    onChange={(e) => setOAuthRedirectUri(e.target.value)}
                  />
                  <Input
                    label="Scope (optional)"
                    placeholder="e.g. openid"
                    value={oauthScope}
                    onChange={(e) => setOAuthScope(e.target.value)}
                  />
                </div>
              )}
              {!oauthEnabled && (
                <Input
                  label="Bearer token (optional)"
                  placeholder="OAuth or API token for servers that require auth"
                  type="password"
                  value={bearerToken}
                  onChange={(e) => setBearerToken(e.target.value)}
                  autoComplete="off"
                />
              )}
              <div>
                <div className="block text-xs text-hooman-muted uppercase tracking-wide mb-1">
                  Custom headers (optional)
                </div>
                <div className="space-y-2">
                  {headerEntries.map((entry, i) => (
                    <div key={i} className="flex gap-2 items-center flex-wrap">
                      <Input
                        placeholder="Key"
                        value={entry.key}
                        onChange={(e) =>
                          setHeaderEntries((prev) =>
                            prev.map((p, j) =>
                              j === i ? { ...p, key: e.target.value } : p,
                            ),
                          )
                        }
                        className="flex-1 min-w-[100px]"
                      />
                      <Input
                        placeholder="Value"
                        value={entry.value}
                        onChange={(e) =>
                          setHeaderEntries((prev) =>
                            prev.map((p, j) =>
                              j === i ? { ...p, value: e.target.value } : p,
                            ),
                          )
                        }
                        className="flex-1 min-w-[100px]"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        iconOnly
                        icon={<Trash2 />}
                        aria-label="Remove header"
                        onClick={() =>
                          setHeaderEntries((prev) =>
                            prev.filter((_, j) => j !== i),
                          )
                        }
                        className="text-red-400 hover:text-red-300"
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    icon={<Plus />}
                    onClick={() =>
                      setHeaderEntries((prev) => [
                        ...prev,
                        { key: "", value: "" },
                      ])
                    }
                  >
                    Add header
                  </Button>
                </div>
              </div>
            </>
          )}
          {form.type === "streamable_http" && (
            <>
              <Input
                label="Name"
                placeholder="e.g. Streamable HTTP Server"
                value={form.name ?? ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
              />
              <Input
                label="URL"
                placeholder="http://localhost:8000/mcp"
                value={form.url ?? ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, url: e.target.value }))
                }
              />
              {!oauthEnabled && (
                <Input
                  label="Bearer token (optional)"
                  placeholder="OAuth or API token for servers that require auth"
                  type="password"
                  value={bearerToken}
                  onChange={(e) => setBearerToken(e.target.value)}
                  autoComplete="off"
                />
              )}
              <div>
                <div className="block text-xs text-hooman-muted uppercase tracking-wide mb-1">
                  Custom headers (optional)
                </div>
                <div className="space-y-2">
                  {headerEntries.map((entry, i) => (
                    <div key={i} className="flex gap-2 items-center flex-wrap">
                      <Input
                        placeholder="Key"
                        value={entry.key}
                        onChange={(e) =>
                          setHeaderEntries((prev) =>
                            prev.map((p, j) =>
                              j === i ? { ...p, key: e.target.value } : p,
                            ),
                          )
                        }
                        className="flex-1 min-w-[100px]"
                      />
                      <Input
                        placeholder="Value"
                        value={entry.value}
                        onChange={(e) =>
                          setHeaderEntries((prev) =>
                            prev.map((p, j) =>
                              j === i ? { ...p, value: e.target.value } : p,
                            ),
                          )
                        }
                        className="flex-1 min-w-[100px]"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        iconOnly
                        icon={<Trash2 />}
                        aria-label="Remove header"
                        onClick={() =>
                          setHeaderEntries((prev) =>
                            prev.filter((_, j) => j !== i),
                          )
                        }
                        className="text-red-400 hover:text-red-300"
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    icon={<Plus />}
                    onClick={() =>
                      setHeaderEntries((prev) => [
                        ...prev,
                        { key: "", value: "" },
                      ])
                    }
                  >
                    Add header
                  </Button>
                </div>
              </div>
              <Checkbox
                id="http-oauth"
                label="Use OAuth (PKCE, optional DCR)"
                checked={oauthEnabled}
                onChange={(checked) => setOAuthEnabled(checked)}
              />
              {oauthEnabled && (
                <div className="space-y-2 rounded-lg border border-hooman-border p-3 bg-hooman-bg/50">
                  <Input
                    label="Authorization server URL (optional)"
                    placeholder="Override when discovery from MCP URL is not used"
                    value={oauthAuthServerUrl}
                    onChange={(e) => setOAuthAuthServerUrl(e.target.value)}
                  />
                  <Input
                    label="Client ID (optional; leave empty for DCR)"
                    placeholder="Pre-registered client or leave empty for dynamic registration"
                    value={oauthClientId}
                    onChange={(e) => setOAuthClientId(e.target.value)}
                  />
                  <Input
                    label="Client secret (optional)"
                    placeholder="For confidential clients"
                    type="password"
                    value={oauthClientSecret}
                    onChange={(e) => setOAuthClientSecret(e.target.value)}
                    autoComplete="off"
                  />
                  <Input
                    label="Redirect URI"
                    placeholder="Callback URL"
                    value={oauthRedirectUri || oauthCallbackUrl}
                    onChange={(e) => setOAuthRedirectUri(e.target.value)}
                  />
                  <Input
                    label="Scope (optional)"
                    placeholder="e.g. openid"
                    value={oauthScope}
                    onChange={(e) => setOAuthScope(e.target.value)}
                  />
                </div>
              )}
              <Input
                label="Timeout (seconds)"
                placeholder="10"
                type="number"
                value={form.timeout_seconds ?? ""}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    timeout_seconds: e.target.value
                      ? Number(e.target.value)
                      : undefined,
                  }))
                }
              />
              <Checkbox
                id="http-cache-tools"
                label="Cache tools list"
                checked={form.cache_tools_list ?? true}
                onChange={(checked) =>
                  setForm((f) => ({ ...f, cache_tools_list: checked }))
                }
              />
              <Input
                label="Max retry attempts"
                placeholder="3"
                type="number"
                value={form.max_retry_attempts ?? ""}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    max_retry_attempts: e.target.value
                      ? Number(e.target.value)
                      : undefined,
                  }))
                }
              />
            </>
          )}
          {form.type === "stdio" && (
            <>
              <Input
                label="Name"
                placeholder="e.g. Filesystem Server"
                value={form.name ?? ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
              />
              <Input
                label="Command"
                placeholder="yarn"
                value={form.command ?? ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, command: e.target.value }))
                }
              />
              <Input
                label="Args (comma-separated)"
                placeholder="-y, @modelcontextprotocol/server-filesystem, /path"
                value={argsRaw}
                onChange={(e) => setArgsRaw(e.target.value)}
              />
              <Input
                label="Working directory (optional)"
                placeholder="/path/to/cwd"
                value={form.cwd ?? ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, cwd: e.target.value }))
                }
              />
              <div>
                <div className="block text-xs text-hooman-muted uppercase tracking-wide mb-1">
                  Environment variables (optional)
                </div>
                <div className="space-y-2">
                  {envEntries.map((entry, i) => (
                    <div key={i} className="flex gap-2 items-center flex-wrap">
                      <Input
                        placeholder="Key"
                        value={entry.key}
                        onChange={(e) =>
                          setEnvEntries((prev) =>
                            prev.map((p, j) =>
                              j === i ? { ...p, key: e.target.value } : p,
                            ),
                          )
                        }
                        className="flex-1 min-w-[100px]"
                      />
                      <Input
                        placeholder="Value"
                        value={entry.value}
                        onChange={(e) =>
                          setEnvEntries((prev) =>
                            prev.map((p, j) =>
                              j === i ? { ...p, value: e.target.value } : p,
                            ),
                          )
                        }
                        className="flex-1 min-w-[100px]"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        iconOnly
                        icon={<Trash2 />}
                        aria-label="Remove variable"
                        onClick={() =>
                          setEnvEntries((prev) =>
                            prev.filter((_, j) => j !== i),
                          )
                        }
                        className="text-red-400 hover:text-red-300"
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    icon={<Plus />}
                    onClick={() =>
                      setEnvEntries((prev) => [...prev, { key: "", value: "" }])
                    }
                  >
                    Add variable
                  </Button>
                </div>
              </div>
            </>
          )}
          {form.type && (
            <>
              <Input
                label="Allowed tool names"
                placeholder="Comma-separated; empty = allow all"
                value={allowedToolsRaw}
                onChange={(e) => setAllowedToolsRaw(e.target.value)}
              />
              <Input
                label="Blocked tool names"
                placeholder="Comma-separated names to block"
                value={blockedToolsRaw}
                onChange={(e) => setBlockedToolsRaw(e.target.value)}
              />
            </>
          )}
        </div>
      </Modal>

      {error && !editing && (
        <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-2 text-sm">
          {error}
        </div>
      )}

      <p className="text-xs font-medium text-hooman-muted uppercase tracking-wider mb-2">
        Your MCP servers
      </p>
      <ul className="space-y-3">
        {connections.map((c) => (
          <li
            key={c.id}
            className="rounded-xl border border-hooman-border bg-hooman-surface p-4 flex items-start justify-between"
          >
            <div className="min-w-0">
              <span className="inline-block rounded px-2 py-0.5 text-xs font-medium bg-hooman-accent/20 text-hooman-accent mr-2">
                {connectionTypeBadge(c)}
              </span>
              <span className="font-medium text-white">
                {connectionLabel(c)}
              </span>
              {c.type === "hosted" && c.server_url && (
                <p className="text-xs text-hooman-muted truncate mt-0.5">
                  {c.server_url}
                </p>
              )}
              {c.type === "streamable_http" && c.url && (
                <p className="text-xs text-hooman-muted truncate mt-0.5">
                  {c.url}
                </p>
              )}
              {c.type === "stdio" && (
                <p className="text-xs text-hooman-muted truncate mt-0.5">
                  {c.command} {c.args?.join(" ")}
                </p>
              )}
              {(c.type === "hosted" || c.type === "streamable_http") &&
                (c as MCPConnectionHosted | MCPConnectionStreamableHttp)
                  .oauth && (
                  <p className="text-xs mt-0.5">
                    <span
                      className={
                        (c as MCPConnectionHosted | MCPConnectionStreamableHttp)
                          .oauth_has_tokens
                          ? "text-green-400"
                          : "text-amber-400"
                      }
                    >
                      OAuth:{" "}
                      {(c as MCPConnectionHosted | MCPConnectionStreamableHttp)
                        .oauth_has_tokens
                        ? "connected"
                        : "needs authorization"}
                    </span>
                  </p>
                )}
            </div>
            <div className="flex gap-2 shrink-0 items-center flex-wrap">
              <Button
                type="button"
                variant={c.enabled !== false ? "success" : "danger"}
                size="sm"
                onClick={async () => {
                  setError(null);
                  try {
                    await updateMCPConnection(c.id, {
                      ...c,
                      enabled: c.enabled === false,
                    });
                    load();
                    await onConnectionsChange?.();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                {c.enabled !== false ? "On" : "Off"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<Pencil className="w-4 h-4" />}
                onClick={() => startEdit(c)}
              >
                Edit
              </Button>
              {(c.type === "hosted" || c.type === "streamable_http") &&
                (c as MCPConnectionHosted | MCPConnectionStreamableHttp)
                  .oauth && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      setOAuthStartingId(c.id);
                      try {
                        const result = await startMCPOAuth(c.id);
                        if ("authorizationUrl" in result) {
                          window.open(result.authorizationUrl, "_blank");
                          setTimeout(() => load(), 3000);
                        } else {
                          load();
                        }
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setOAuthStartingId(null);
                      }
                    }}
                    disabled={oauthStartingId !== null}
                  >
                    {oauthStartingId === c.id ? "Opening…" : "Connect"}
                  </Button>
                )}
              <Button
                variant="danger"
                size="sm"
                icon={<Trash2 className="w-4 h-4" />}
                onClick={() => remove(c.id)}
              >
                Remove
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {connections.length === 0 && !editing && (
        <p className="text-hooman-muted text-sm">
          No custom MCP servers yet. Add one to delegate tools.
        </p>
      )}

      {systemConnections.length > 0 && (
        <div className="mt-6">
          <p className="text-xs font-medium text-hooman-muted uppercase tracking-wider mb-2">
            System MCPs
          </p>
          <ul className="space-y-3">
            {systemConnections.map((s) => (
              <li
                key={s.id}
                className="rounded-xl border border-hooman-border/80 bg-hooman-surface/60 p-4 flex items-center justify-between"
              >
                <div className="min-w-0 flex items-center gap-2">
                  <span className="inline-block rounded px-2 py-0.5 text-xs font-medium bg-hooman-muted/30 text-hooman-muted mr-2">
                    System
                  </span>
                  <span className="font-medium text-white">{s.name}</span>
                </div>
                <div className="shrink-0">
                  <Button
                    type="button"
                    variant={s.enabled ? "success" : "danger"}
                    size="sm"
                    onClick={() => toggleSystemMcp(s)}
                    disabled={togglingSystemId !== null}
                  >
                    {togglingSystemId === s.id ? "…" : s.enabled ? "On" : "Off"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Modal
        open={importOpen}
        onClose={() => !importing && setImportOpen(false)}
        title="Import MCP servers"
        maxWidth="2xl"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setImportOpen(false)}
              disabled={importing}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleImportSubmit}
              disabled={importing || !importJson.trim()}
              icon={importing ? undefined : <FileUp className="w-4 h-4" />}
            >
              {importing ? "Importing…" : "Import"}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-hooman-muted mb-3">
          Paste JSON with an <code className="text-zinc-300">mcpServers</code>{" "}
          object. Each key is the server name; value is either{" "}
          <code className="text-zinc-300">command</code> (and optional{" "}
          <code className="text-zinc-300">args</code>,{" "}
          <code className="text-zinc-300">env</code>,{" "}
          <code className="text-zinc-300">cwd</code>) for stdio, or{" "}
          <code className="text-zinc-300">url</code> (and optional{" "}
          <code className="text-zinc-300">headers</code>,{" "}
          <code className="text-zinc-300">auth</code>) for HTTP.{" "}
          <code className="text-zinc-300">auth</code> can include{" "}
          <code className="text-zinc-300">client_id</code>,{" "}
          <code className="text-zinc-300">client_secret</code>,{" "}
          <code className="text-zinc-300">redirect_uri</code>,{" "}
          <code className="text-zinc-300">scope</code> /{" "}
          <code className="text-zinc-300">scopes</code>, and{" "}
          <code className="text-zinc-300">authorization_server_url</code>{" "}
          (snake_case only).
        </p>
        {importError && (
          <p className="text-sm text-red-400 mb-2">{importError}</p>
        )}
        <Textarea
          value={importJson}
          onChange={(e) => setImportJson(e.target.value)}
          placeholder='{"mcpServers": {"my-server": {"command": "npx", "args": ["-y", "some-mcp"], "env": {"DEBUG": "true"}}}}'
          className="font-mono text-sm min-h-[200px]"
          disabled={importing}
        />
      </Modal>
    </>
  );
});
