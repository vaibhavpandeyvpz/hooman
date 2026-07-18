import { basename, dirname } from "node:path";
import readline from "node:readline";
import { stdin, stdout } from "node:process";
import {
  Config as AppConfig,
  type NamedLlmConfig,
  type NamedProviderConfig,
  type SearchConfig,
} from "../../core/config.js";
import { Config as McpFileConfig } from "../../core/mcp/config.js";
import { McpTransportSchema, type McpTransport } from "../../core/mcp/types.js";
import {
  NamedLlmConfigSchema,
  NamedProviderConfigSchema,
} from "../../core/models/types.js";
import {
  createSkillsRegistry,
  type Registry,
} from "../../core/skills/index.js";
import {
  basePath,
  configJsonPath,
  mcpJsonPath,
  skillsPath,
} from "../../core/utils/paths.js";

/**
 * Hooman's versioned management RPC (plan §5.4): a small stdio JSON-RPC 2.0
 * server, hosted by the same bundled runtime distribution as `hooman acp`,
 * exposing global configuration, MCP, and skills CRUD to first-party
 * clients (desktop today; VS Code settings can migrate onto this later).
 *
 * Deliberately global-scope only in this version — project-level config/MCP
 * overlays are read-through from `session/*` on the ACP connection already,
 * and are not yet editable here. `session/set_config_option` remains the
 * live-session path; this process only edits the shared on-disk files.
 *
 * Framing matches ACP's own NDJSON convention (one JSON object per line) but
 * intentionally does not depend on `@agentclientprotocol/sdk`'s ACP-specific
 * `agent`/`client` builders, since this is not an ACP session protocol.
 */

export const MANAGEMENT_PROTOCOL_VERSION = 1;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
};
type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
};

const SECRET_KEY_PATTERN = /key|token|secret|password|authorization/i;

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY_PATTERN.test(key) ? "••••••••" : redactSecrets(val);
    }
    return out;
  }
  return value;
}

/** Shallow-merges provider/LLM option patches: omitted key = unchanged, `null` = clear, value = replace. */
function mergeOptions(
  existing: Record<string, unknown> | undefined,
  patch: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(existing ?? {}) };
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === null) delete merged[key];
    else merged[key] = value;
  }
  return merged;
}

class ManagementError extends Error {}

class ManagementHandlers {
  #config = new AppConfig(configJsonPath());
  #mcp = new McpFileConfig(mcpJsonPath());
  #skills: Registry = createSkillsRegistry(basePath());

  async initialize(): Promise<{
    protocolVersion: number;
    capabilities: string[];
  }> {
    return {
      protocolVersion: MANAGEMENT_PROTOCOL_VERSION,
      capabilities: ["config", "mcp", "skills", "setupStatus"],
    };
  }

  /** Real on-disk paths for the desktop main process's "open in native editor" actions. */
  paths(): { config: string; mcp: string; skills: string } {
    return {
      config: configJsonPath(),
      mcp: mcpJsonPath(),
      skills: skillsPath(),
    };
  }

  setupStatus(): { configured: boolean } {
    try {
      this.#config.reload();
      return { configured: true };
    } catch {
      return { configured: false };
    }
  }

  configGet(): unknown {
    this.#config.reload();
    return redactSecrets({
      name: this.#config.name,
      providers: this.#config.providers,
      llms: this.#config.llms,
      search: this.#config.search,
      prompts: this.#config.prompts,
      tools: this.#config.tools,
      compaction: this.#config.compaction,
      reasoning: this.#config.reasoning,
      daemon: this.#config.daemon,
    });
  }

  /**
   * `params` is `{ name, provider, options }` where `options` is a *patch*:
   * omitted keys keep the existing (possibly secret) value, `null` clears a
   * key, any other value replaces it. The merged object is validated against
   * the full discriminated-union provider schema before writing, so a
   * malformed or incomplete patch is rejected rather than silently persisted.
   */
  configUpsertProvider(params: unknown): { ok: true } {
    const patch = params as {
      name: string;
      provider: string;
      options?: Record<string, unknown>;
    };
    if (!patch?.name || !patch.provider)
      throw new ManagementError("Missing provider name or provider type.");
    this.#config.reload();
    const existing = this.#config.providers.find((p) => p.name === patch.name);
    const candidate = {
      name: patch.name,
      provider: patch.provider,
      options: mergeOptions(
        existing?.options as Record<string, unknown> | undefined,
        patch.options,
      ),
    };
    const parsed = NamedProviderConfigSchema.safeParse(candidate);
    if (!parsed.success) {
      throw new ManagementError(
        `Invalid provider configuration: ${parsed.error.issues[0]?.message ?? "unknown error"}`,
      );
    }
    const provider: NamedProviderConfig = parsed.data;
    const providers = existing
      ? this.#config.providers.map((p) =>
          p.name === provider.name ? provider : p,
        )
      : [...this.#config.providers, provider];
    const result = this.#config.tryUpdate({ providers });
    if (!result.ok) throw new ManagementError(result.error);
    return { ok: true };
  }

  configDeleteProvider(params: unknown): { ok: true } {
    const { name } = (params as { name: string }) ?? {};
    if (!name) throw new ManagementError("Missing provider name.");
    this.#config.reload();
    if (this.#config.llms.some((llm) => llm.provider === name)) {
      throw new ManagementError(
        `Provider "${name}" is still used by one or more LLMs.`,
      );
    }
    const providers = this.#config.providers.filter((p) => p.name !== name);
    const result = this.#config.tryUpdate({ providers });
    if (!result.ok) throw new ManagementError(result.error);
    return { ok: true };
  }

  configUpsertLlm(params: unknown): { ok: true } {
    const llm = NamedLlmConfigSchema.parse(params);
    this.#config.reload();
    const exists = this.#config.llms.some((entry) => entry.name === llm.name);
    const llms: NamedLlmConfig[] = exists
      ? this.#config.llms.map((entry) =>
          entry.name === llm.name ? llm : entry,
        )
      : [...this.#config.llms, llm];
    const result = this.#config.tryUpdate({ llms });
    if (!result.ok) throw new ManagementError(result.error);
    return { ok: true };
  }

  configDeleteLlm(params: unknown): { ok: true } {
    const { name } = (params as { name: string }) ?? {};
    if (!name) throw new ManagementError("Missing LLM name.");
    this.#config.reload();
    const llms = this.#config.llms.filter((entry) => entry.name !== name);
    if (llms.length === 0)
      throw new ManagementError("Cannot delete the only remaining LLM.");
    if (
      !llms.some((entry) => entry.default) &&
      this.#config.llms.find((e) => e.name === name)?.default
    ) {
      llms[0]!.default = true;
    }
    const result = this.#config.tryUpdate({ llms });
    if (!result.ok) throw new ManagementError(result.error);
    return { ok: true };
  }

  configSaveGeneral(params: unknown): { ok: true } {
    const patch = params as {
      name?: string;
      reasoning?: "collapsed" | "full";
      compaction?: { ratio?: number; keep?: number };
    };
    this.#config.reload();
    const result = this.#config.tryUpdate({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.reasoning !== undefined ? { reasoning: patch.reasoning } : {}),
      ...(patch.compaction !== undefined
        ? { compaction: { ...this.#config.compaction, ...patch.compaction } }
        : {}),
    });
    if (!result.ok) throw new ManagementError(result.error);
    return { ok: true };
  }

  configSetPromptToggle(params: unknown): { ok: true } {
    const { key, value } = params as { key: string; value: boolean };
    if (!key) throw new ManagementError("Missing prompt toggle key.");
    this.#config.reload();
    const result = this.#config.tryUpdate({
      prompts: { ...this.#config.prompts, [key]: value },
    });
    if (!result.ok) throw new ManagementError(result.error);
    return { ok: true };
  }

  configSetToolToggle(params: unknown): { ok: true } {
    const { key, value } = params as { key: string; value: boolean };
    if (!key) throw new ManagementError("Missing tool toggle key.");
    this.#config.reload();
    const result = this.#config.tryUpdate({
      tools: { ...this.#config.tools, [key]: { enabled: value } },
    });
    if (!result.ok) throw new ManagementError(result.error);
    return { ok: true };
  }

  configSaveSearch(params: unknown): { ok: true } {
    const patch = params as {
      enabled?: boolean;
      provider?: string;
      apiKey?: string;
      baseURL?: string;
      tool?: string;
    };
    this.#config.reload();
    const current = this.#config.search as Record<string, unknown>;
    const next: Record<string, unknown> = { ...current };
    if (patch.enabled !== undefined) next.enabled = patch.enabled;
    if (patch.provider !== undefined) next.provider = patch.provider;
    const provider = patch.provider ?? (current.provider as string | undefined);
    if (
      provider &&
      (patch.apiKey !== undefined ||
        patch.baseURL !== undefined ||
        patch.tool !== undefined)
    ) {
      const existing = current[provider] as Record<string, unknown> | undefined;
      next[provider] = {
        ...existing,
        ...(patch.apiKey !== undefined ? { apiKey: patch.apiKey } : {}),
        ...(patch.baseURL !== undefined ? { baseURL: patch.baseURL } : {}),
        ...(patch.tool !== undefined ? { tool: patch.tool } : {}),
      };
    }
    const result = this.#config.tryUpdate({ search: next as SearchConfig });
    if (!result.ok) throw new ManagementError(result.error);
    return { ok: true };
  }

  mcpList(): unknown {
    this.#mcp.reload();
    return redactSecrets(this.#mcp.listWithSources());
  }

  mcpUpsert(params: unknown): { ok: true } {
    const { name, transport } = params as {
      name: string;
      transport: McpTransport;
    };
    if (!name) throw new ManagementError("Missing MCP server name.");
    const parsedTransport = McpTransportSchema.parse(transport);
    this.#mcp.reload();
    if (this.#mcp.get(name)) this.#mcp.update(name, parsedTransport);
    else this.#mcp.add(name, parsedTransport);
    return { ok: true };
  }

  mcpDelete(params: unknown): { ok: true } {
    const { name } = (params as { name: string }) ?? {};
    if (!name) throw new ManagementError("Missing MCP server name.");
    this.#mcp.reload();
    this.#mcp.remove(name);
    return { ok: true };
  }

  /** Installed skills — same `skills` CLI (`npx skills`) the CLI's `hooman configure` and the VS Code extension use. */
  async skillsList(): Promise<
    Array<{ name: string; description?: string; folder: string }>
  > {
    const entries = await this.#skills.list();
    return entries.map((entry) => ({
      name: entry.name,
      description: entry.description,
      folder: basename(dirname(entry.path)),
    }));
  }

  skillsSearch(
    params: unknown,
  ): Promise<
    Array<{ name: string; slug: string; source: string; installs: number }>
  > {
    const { query } = (params as { query: string }) ?? {};
    return this.#skills.search(query ?? "");
  }

  async skillsInstall(params: unknown): Promise<{ ok: true }> {
    const { source } = (params as { source: string }) ?? {};
    await this.#skills.install(source ?? "");
    return { ok: true };
  }

  async skillsDelete(params: unknown): Promise<{ ok: true }> {
    const { folder } = (params as { folder: string }) ?? {};
    await this.#skills.delete(folder ?? "");
    return { ok: true };
  }
}

const METHODS: Record<
  string,
  (handlers: ManagementHandlers, params: unknown) => unknown
> = {
  initialize: (h) => h.initialize(),
  "paths/get": (h) => h.paths(),
  "setup/status": (h) => h.setupStatus(),
  "config/get": (h) => h.configGet(),
  "config/upsertProvider": (h, p) => h.configUpsertProvider(p),
  "config/deleteProvider": (h, p) => h.configDeleteProvider(p),
  "config/upsertLlm": (h, p) => h.configUpsertLlm(p),
  "config/deleteLlm": (h, p) => h.configDeleteLlm(p),
  "config/saveGeneral": (h, p) => h.configSaveGeneral(p),
  "config/setPromptToggle": (h, p) => h.configSetPromptToggle(p),
  "config/setToolToggle": (h, p) => h.configSetToolToggle(p),
  "config/saveSearch": (h, p) => h.configSaveSearch(p),
  "mcp/list": (h) => h.mcpList(),
  "mcp/upsert": (h, p) => h.mcpUpsert(p),
  "mcp/delete": (h, p) => h.mcpDelete(p),
  "skills/list": (h) => h.skillsList(),
  "skills/search": (h, p) => h.skillsSearch(p),
  "skills/install": (h, p) => h.skillsInstall(p),
  "skills/delete": (h, p) => h.skillsDelete(p),
};

/** Run the management server on stdio. Mirrors ACP's stdout-is-the-protocol discipline. */
export async function runManagementStdio(): Promise<void> {
  const handlers = new ManagementHandlers();
  const rl = readline.createInterface({ input: stdin });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    void handleLine(handlers, trimmed);
  });
  await new Promise<void>((resolve) => rl.on("close", resolve));
}

async function handleLine(
  handlers: ManagementHandlers,
  line: string,
): Promise<void> {
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(line) as JsonRpcRequest;
  } catch {
    return;
  }
  const handler = METHODS[request.method];
  if (!handler) {
    write({
      jsonrpc: "2.0",
      id: request.id,
      error: { code: -32601, message: `Method not found: ${request.method}` },
    });
    return;
  }
  try {
    const result = await handler(handlers, request.params);
    write({ jsonrpc: "2.0", id: request.id, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof ManagementError ? -32000 : -32001;
    write({ jsonrpc: "2.0", id: request.id, error: { code, message } });
  }
}

function write(response: JsonRpcResponse): void {
  stdout.write(`${JSON.stringify(response)}\n`);
}
