import { createMemo, createSignal, For, Show } from "solid-js";
import {
  ArrowUpRight,
  Check,
  Cpu,
  FileCode2,
  Pencil,
  Plus,
  Plug,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  X,
} from "lucide-solid";
import type {
  ConfigLlmEntryState,
  ConfigProviderEntryState,
  McpServerEntryState,
  ProviderKind,
  SearchProvider,
  SkillInstalledEntryInfo,
  SkillSearchResultInfo,
} from "../../src/shared/settings";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  LLM_FIELD_DEFINITIONS,
  LLM_METADATA_FIELD_DEFINITIONS,
  PROMPT_LABELS,
  PROVIDER_FIELD_DEFINITIONS,
  SEARCH_PROVIDER_LABELS,
  SUPPORTED_PROVIDER_TYPES,
} from "../../src/shared/settings";
import {
  sendConfigEditorAction,
  sendMcpEditorAction,
  sendSkillsViewAction,
  state,
} from "../store";

type Mode = "config" | "mcp" | "skills";

export default function SettingsEditorView(props: { mode: Mode }) {
  const configState = createMemo(() => state.configEditorView);
  const mcpState = createMemo(() => state.mcpEditorView);
  const skillsState = createMemo(() => state.skillsView);

  return (
    <div class="flex h-full min-h-0 flex-col bg-[var(--vscode-editor-background)] text-foreground">
      <header class="shrink-0 border-b border-border bg-[var(--vscode-sideBar-background)] px-5 py-3">
        <Header mode={props.mode} />
      </header>

      <div class="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <Show when={props.mode === "config" && configState()}>
          {(cfg) => <ConfigModeView state={cfg()} />}
        </Show>
        <Show when={props.mode === "mcp" && mcpState()}>
          {(mcp) => <McpModeView state={mcp()} />}
        </Show>
        <Show when={props.mode === "skills" && skillsState()}>
          {(skills) => <SkillsModeView state={skills()} />}
        </Show>
      </div>
    </div>
  );
}

function Header(props: { mode: Mode }) {
  const configState = createMemo(() => state.configEditorView);
  const mcpState = createMemo(() => state.mcpEditorView);
  const skillsState = createMemo(() => state.skillsView);

  const title = createMemo(() => {
    switch (props.mode) {
      case "config":
        return "Hooman configuration";
      case "mcp":
        return "Hooman MCP";
      case "skills":
        return "Hooman skills";
    }
  });

  const subtitle = createMemo(() => {
    switch (props.mode) {
      case "config":
        return configState()?.path;
      case "mcp":
        return mcpState()?.path;
      case "skills":
        return skillsState()?.homePath;
    }
  });

  return (
    <div class="flex items-center justify-between gap-4">
      <div class="min-w-0 flex-1">
        <div class="truncate text-lg font-semibold">{title()}</div>
        <div class="truncate text-xs text-muted">{subtitle()}</div>
      </div>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class={ghostButtonClass}
          onClick={() => {
            switch (props.mode) {
              case "config":
                sendConfigEditorAction({ type: "refresh" });
                return;
              case "mcp":
                sendMcpEditorAction({ type: "refresh" });
                return;
              case "skills":
                sendSkillsViewAction({ type: "refresh" });
                return;
            }
          }}
        >
          <RefreshCw size={13} /> Refresh
        </button>
        <Show when={props.mode !== "skills"}>
          <button
            type="button"
            class={ghostButtonClass}
            onClick={() => {
              switch (props.mode) {
                case "config":
                  sendConfigEditorAction({ type: "openRaw" });
                  return;
                case "mcp":
                  sendMcpEditorAction({ type: "openRaw" });
                  return;
                case "skills":
                  return;
              }
            }}
          >
            <FileCode2 size={13} /> Open raw
          </button>
        </Show>
      </div>
    </div>
  );
}

function ConfigModeView(props: {
  state: NonNullable<typeof state.configEditorView>;
}) {
  const cfg = () => props.state;
  const [providerDraftName, setProviderDraftName] = createSignal("");
  const [llmDraftName, setLlmDraftName] = createSignal("");
  const [providerType, setProviderType] = createSignal<ProviderKind>("openai");
  const [searchApiKey, setSearchApiKey] = createSignal("");
  const [searchBaseUrl, setSearchBaseUrl] = createSignal("");
  const [searchTool, setSearchTool] = createSignal("");

  const [editingProvider, setEditingProvider] =
    createSignal<ConfigProviderEntryState | null>(null);
  const [editingLlm, setEditingLlm] = createSignal<ConfigLlmEntryState | null>(
    null,
  );

  return (
    <div class="mx-auto flex max-w-6xl flex-col gap-5">
      <Section title="General" icon={<Cpu size={15} class="text-accent" />}>
        <div class="grid gap-4 md:grid-cols-2">
          <Field label="Agent name">
            <input
              class={inputClass}
              value={cfg().appName}
              onChange={(event) =>
                sendConfigEditorAction({
                  type: "saveGeneral",
                  appName: event.currentTarget.value,
                  reasoning: cfg().reasoning,
                  compactionRatio: String(cfg().compaction.ratio),
                  compactionKeep: String(cfg().compaction.keep),
                })
              }
            />
          </Field>
          <Field label="Reasoning display">
            <select
              class={inputClass}
              value={cfg().reasoning}
              onChange={(event) =>
                sendConfigEditorAction({
                  type: "saveGeneral",
                  appName: cfg().appName,
                  reasoning: event.currentTarget.value as "collapsed" | "full",
                  compactionRatio: String(cfg().compaction.ratio),
                  compactionKeep: String(cfg().compaction.keep),
                })
              }
            >
              <option value="collapsed">Collapsed</option>
              <option value="full">Full</option>
            </select>
          </Field>
          <Field label="Compaction ratio">
            <input
              class={inputClass}
              value={String(cfg().compaction.ratio)}
              onChange={(event) =>
                sendConfigEditorAction({
                  type: "saveGeneral",
                  appName: cfg().appName,
                  reasoning: cfg().reasoning,
                  compactionRatio: event.currentTarget.value,
                  compactionKeep: String(cfg().compaction.keep),
                })
              }
            />
          </Field>
          <Field label="Compaction keep">
            <input
              class={inputClass}
              value={String(cfg().compaction.keep)}
              onChange={(event) =>
                sendConfigEditorAction({
                  type: "saveGeneral",
                  appName: cfg().appName,
                  reasoning: cfg().reasoning,
                  compactionRatio: String(cfg().compaction.ratio),
                  compactionKeep: event.currentTarget.value,
                })
              }
            />
          </Field>
        </div>
      </Section>

      <Section title="Prompts">
        <div class="grid gap-2 md:grid-cols-2">
          <For each={Object.entries(PROMPT_LABELS)}>
            {([key, label]) => {
              const promptKey = key as
                "behaviour" | "communication" | "execution" | "guardrails";
              return (
                <ToggleRow
                  label={label}
                  checked={cfg().prompts[promptKey]}
                  onChange={(value) =>
                    sendConfigEditorAction({
                      type: "setPromptToggle",
                      key: promptKey,
                      value,
                    })
                  }
                />
              );
            }}
          </For>
        </div>
      </Section>

      <Section title="Tools & search">
        <div class="grid gap-2 md:grid-cols-2">
          <For each={Object.entries(cfg().tools)}>
            {([key, value]) => {
              const toolKey = key as
                | "todo"
                | "fetch"
                | "filesystem"
                | "shell"
                | "sleep"
                | "browser"
                | "subagents";
              return (
                <ToggleRow
                  label={key}
                  checked={Boolean(value)}
                  onChange={(next) =>
                    sendConfigEditorAction({
                      type: "setToolToggle",
                      key: toolKey,
                      value: next,
                    })
                  }
                />
              );
            }}
          </For>
        </div>
        <div class="mt-4 grid gap-4 md:grid-cols-2">
          <ToggleRow
            label="Search enabled"
            checked={cfg().search.enabled}
            onChange={(enabled) =>
              sendConfigEditorAction({
                type: "saveSearch",
                enabled,
                provider: cfg().search.provider,
                apiKey:
                  cfg().search.provider === "duckduckgo"
                    ? ""
                    : (cfg().search[cfg().search.provider].apiKey ??
                      searchApiKey()),
                baseURL: cfg().search.litellm.baseURL ?? searchBaseUrl(),
                tool: cfg().search.litellm.tool ?? searchTool(),
              })
            }
          />
          <Field label="Search provider">
            <select
              class={inputClass}
              value={cfg().search.provider}
              onChange={(event) => {
                const provider = event.currentTarget.value as SearchProvider;
                sendConfigEditorAction({
                  type: "saveSearch",
                  enabled: cfg().search.enabled,
                  provider,
                  apiKey:
                    provider === "duckduckgo"
                      ? ""
                      : (cfg().search[provider].apiKey ?? searchApiKey()) ||
                        "placeholder",
                  baseURL: cfg().search.litellm.baseURL,
                  tool: cfg().search.litellm.tool,
                });
              }}
            >
              <For each={Object.entries(SEARCH_PROVIDER_LABELS)}>
                {([value, label]) => <option value={value}>{label}</option>}
              </For>
            </select>
          </Field>
          <Show when={cfg().search.provider !== "duckduckgo"}>
            <Field
              label={
                cfg().search.provider === "litellm" ? "Virtual key" : "API key"
              }
            >
              <input
                class={inputClass}
                value={
                  cfg().search.provider === "duckduckgo"
                    ? ""
                    : (cfg().search[cfg().search.provider].apiKey ??
                      searchApiKey())
                }
                onInput={(event) => setSearchApiKey(event.currentTarget.value)}
                onChange={(event) =>
                  sendConfigEditorAction({
                    type: "saveSearch",
                    enabled: cfg().search.enabled,
                    provider: cfg().search.provider,
                    apiKey: event.currentTarget.value,
                    baseURL: cfg().search.litellm.baseURL ?? searchBaseUrl(),
                    tool: cfg().search.litellm.tool ?? searchTool(),
                  })
                }
              />
            </Field>
          </Show>
          <Show when={cfg().search.provider === "litellm"}>
            <>
              <Field label="Base URL">
                <input
                  class={inputClass}
                  value={cfg().search.litellm.baseURL ?? searchBaseUrl()}
                  onInput={(event) =>
                    setSearchBaseUrl(event.currentTarget.value)
                  }
                  onChange={(event) =>
                    sendConfigEditorAction({
                      type: "saveSearch",
                      enabled: cfg().search.enabled,
                      provider: cfg().search.provider,
                      apiKey: cfg().search.litellm.apiKey ?? searchApiKey(),
                      baseURL: event.currentTarget.value,
                      tool: cfg().search.litellm.tool ?? searchTool(),
                    })
                  }
                />
              </Field>
              <Field label="Search tool name">
                <input
                  class={inputClass}
                  value={cfg().search.litellm.tool ?? searchTool()}
                  onInput={(event) => setSearchTool(event.currentTarget.value)}
                  onChange={(event) =>
                    sendConfigEditorAction({
                      type: "saveSearch",
                      enabled: cfg().search.enabled,
                      provider: cfg().search.provider,
                      apiKey: cfg().search.litellm.apiKey ?? searchApiKey(),
                      baseURL: cfg().search.litellm.baseURL ?? searchBaseUrl(),
                      tool: event.currentTarget.value,
                    })
                  }
                />
              </Field>
            </>
          </Show>
        </div>
      </Section>

      <Section title="Providers" icon={<Plug size={15} class="text-accent" />}>
        <div class="mb-3 flex items-stretch gap-2">
          <input
            class={`${inputClass} max-w-56`}
            placeholder="New provider name"
            value={providerDraftName()}
            onInput={(event) => setProviderDraftName(event.currentTarget.value)}
          />
          <select
            class={`${inputClass} max-w-44`}
            value={providerType()}
            onChange={(event) =>
              setProviderType(event.currentTarget.value as ProviderKind)
            }
          >
            <For each={SUPPORTED_PROVIDER_TYPES}>
              {(kind) => <option value={kind}>{kind}</option>}
            </For>
          </select>
          <button
            type="button"
            class={primaryButtonClass}
            onClick={() =>
              setEditingProvider({
                name: providerDraftName() || "New provider",
                provider: providerType(),
                usageCount: 0,
                options: {},
                fields: {
                  name: providerDraftName() || "",
                  model: DEFAULT_MODEL_BY_PROVIDER[providerType()],
                },
              })
            }
          >
            <Plus size={14} /> Add provider
          </button>
        </div>
        <div class="space-y-4">
          <For each={cfg().providers}>
            {(provider) => (
              <SummaryCard
                title={provider.name}
                subtitle={`${providerKindLabel(provider.provider)} • ${provider.usageCount} model(s)`}
                onEdit={() => setEditingProvider(provider)}
                onDelete={() =>
                  sendConfigEditorAction({
                    type: "deleteProvider",
                    name: provider.name,
                  })
                }
              />
            )}
          </For>
        </div>
      </Section>

      <Section title="LLMs" icon={<Cpu size={15} class="text-accent" />}>
        <div class="mb-3 flex items-stretch gap-2">
          <input
            class={`${inputClass} min-w-0 max-w-56 flex-1`}
            placeholder="New LLM name"
            value={llmDraftName()}
            onInput={(event) => setLlmDraftName(event.currentTarget.value)}
          />
          <button
            type="button"
            class={primaryButtonClass}
            onClick={() =>
              setEditingLlm({
                name: llmDraftName() || "New LLM",
                provider: cfg().providers[0]?.name ?? "",
                options: {
                  model: cfg().providers[0]
                    ? DEFAULT_MODEL_BY_PROVIDER[cfg().providers[0].provider]
                    : "",
                  temperature: undefined,
                  topP: undefined,
                  maxTokens: undefined,
                  context: undefined,
                },
                metadata: undefined,
                fields: {
                  name: llmDraftName() || "",
                  provider: cfg().providers[0]?.name ?? "",
                  model: cfg().providers[0]
                    ? DEFAULT_MODEL_BY_PROVIDER[cfg().providers[0].provider]
                    : "",
                  temperature: "",
                  topP: "",
                  maxTokens: "",
                  context: "",
                  metadataName: "",
                  metadataContext: "",
                  metadataCostInput: "",
                  metadataCostCache: "",
                  metadataCostOutput: "",
                  metadataModalityText: "",
                  metadataModalityImage: "",
                  metadataModalityPdf: "",
                  metadataModalityAudio: "",
                  metadataModalityVideo: "",
                },

                default: false,
              })
            }
          >
            <Plus size={14} /> Add LLM
          </button>
        </div>
        <div class="space-y-4">
          <For each={cfg().llms}>
            {(llm) => (
              <SummaryCard
                title={llm.name}
                subtitle={`${llm.provider} • ${llm.options.model}`}
                accent={llm.default ? "Default" : undefined}
                onEdit={() => setEditingLlm(llm)}
                onDelete={() => {
                  if (!llm.default) {
                    sendConfigEditorAction({
                      type: "deleteLlm",
                      name: llm.name,
                    });
                  }
                }}
                extraAction={{
                  label: llm.default ? "Default" : "Set default",
                  onClick: () =>
                    sendConfigEditorAction({
                      type: "setDefaultLlm",
                      name: llm.name,
                    }),
                  disabled: llm.default,
                }}
              />
            )}
          </For>
        </div>
      </Section>

      <Show when={editingProvider()}>
        {(provider) => (
          <ProviderDrawer
            provider={provider()}
            onClose={() => setEditingProvider(null)}
            onSave={(fields, providerKind) => {
              sendConfigEditorAction({
                type: "saveProvider",
                originalName: cfg().providers.some(
                  (item) => item.name === provider().name,
                )
                  ? provider().name
                  : undefined,
                providerType: providerKind,
                fields,
              });
              setEditingProvider(null);
            }}
          />
        )}
      </Show>

      <Show when={editingLlm()}>
        {(llm) => (
          <LlmDrawer
            llm={llm()}
            providers={cfg().providers}
            onClose={() => setEditingLlm(null)}
            onSave={(fields) => {
              sendConfigEditorAction({
                type: "saveLlm",
                originalName: cfg().llms.some(
                  (item) => item.name === llm().name,
                )
                  ? llm().name
                  : undefined,
                fields,
              });
              setEditingLlm(null);
            }}
          />
        )}
      </Show>
    </div>
  );
}

function McpModeView(props: {
  state: NonNullable<typeof state.mcpEditorView>;
}) {
  const mcp = () => props.state;
  const [serverDraftName, setServerDraftName] = createSignal("");
  const [editingServer, setEditingServer] =
    createSignal<McpServerEntryState | null>(null);

  return (
    <div class="mx-auto flex max-w-5xl flex-col gap-5">
      <Section
        title="MCP servers"
        icon={<Shield size={15} class="text-accent" />}
      >
        <div class="mb-3 flex items-stretch gap-2">
          <input
            class={`${inputClass} min-w-0 max-w-56 flex-1`}
            placeholder="New server name"
            value={serverDraftName()}
            onInput={(event) => setServerDraftName(event.currentTarget.value)}
          />
          <button
            type="button"
            class={primaryButtonClass}
            onClick={() =>
              setEditingServer({
                name: serverDraftName() || "New server",
                transportType: "stdio",
                summary: "stdio",
                transport: {},
                fields: {
                  name: serverDraftName() || "",
                  command: "npx",
                  args: "[]",
                  env: "",
                  cwd: "",
                },
                authStatus: "unsupported",
              })
            }
          >
            <Plus size={14} /> Add server
          </button>
        </div>
        <div class="space-y-4">
          <For each={mcp().servers}>
            {(server) => (
              <SummaryCard
                title={server.name}
                subtitle={`${transportTypeLabel(server.transportType)} • ${server.summary}`}
                accent={displayMcpAuthStatus(server)}
                onEdit={() => setEditingServer(server)}
                onDelete={() =>
                  sendMcpEditorAction({
                    type: "deleteServer",
                    name: server.name,
                  })
                }
                extraAction={
                  server.transportType !== "stdio" &&
                  server.authStatus !== "unsupported"
                    ? {
                        label: "Auth",
                        onClick: () =>
                          sendMcpEditorAction({
                            type: "authenticate",
                            name: server.name,
                          }),
                      }
                    : undefined
                }
              />
            )}
          </For>
        </div>
      </Section>

      <Section
        title="Related files"
        icon={<ArrowUpRight size={15} class="text-accent" />}
      >
        <div class="grid gap-3 md:grid-cols-2">
          <RelatedFileCard
            label="Global MCP"
            path={mcp().relatedGlobalPath}
            onOpen={() => sendMcpEditorAction({ type: "openRelatedGlobal" })}
          />
          <RelatedFileCard
            label="Project MCP"
            path={mcp().relatedProjectPath}
            onOpen={() => sendMcpEditorAction({ type: "openRelatedProject" })}
          />
        </div>
      </Section>

      <Show when={editingServer()}>
        {(server) => (
          <McpDrawer
            server={server()}
            onClose={() => setEditingServer(null)}
            onSave={(fields, transportType) => {
              sendMcpEditorAction({
                type: "saveServer",
                originalName: mcp().servers.some(
                  (item) => item.name === server().name,
                )
                  ? server().name
                  : undefined,
                transportType,
                fields,
              });
              setEditingServer(null);
            }}
          />
        )}
      </Show>
    </div>
  );
}

function SkillsModeView(props: {
  state: NonNullable<typeof state.skillsView>;
}) {
  const skills = () => props.state;
  const [query, setQuery] = createSignal(skills().query ?? "");
  const [source, setSource] = createSignal("");
  return (
    <div class="mx-auto flex max-w-6xl flex-col gap-5">
      <Section
        title="Search and install"
        icon={<Search size={15} class="text-accent" />}
      >
        <div class="flex items-stretch gap-2">
          <input
            class={`${inputClass} min-w-0 flex-1`}
            placeholder="Search skills catalog"
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
          <button
            type="button"
            class={`${primaryButtonClass} shrink-0`}
            onClick={() =>
              sendSkillsViewAction({ type: "search", query: query() })
            }
          >
            <Search size={14} /> Search
          </button>
        </div>
        <div class="mt-3 flex items-stretch gap-2">
          <input
            class={`${inputClass} min-w-0 flex-1`}
            placeholder="owner/repo, GitHub URL, or local path"
            value={source()}
            onInput={(event) => setSource(event.currentTarget.value)}
          />
          <button
            type="button"
            class={`${primaryButtonClass} shrink-0`}
            onClick={() =>
              sendSkillsViewAction({ type: "installSource", source: source() })
            }
          >
            <Plus size={14} /> Install from source
          </button>
        </div>
        <Show when={skills().busy && skills().busyMessage}>
          <div class="mt-3 rounded-lg border border-border bg-panel/40 px-3 py-2 text-sm text-muted">
            {skills().busyMessage}
          </div>
        </Show>
        <Show
          when={skills().results.length > 0}
          fallback={
            <Show when={!skills().busy && skills().searched}>
              <div class="mt-4 rounded-lg border border-border bg-panel/25 px-4 py-3 text-sm text-muted">
                No skills found for “{skills().query}”.
              </div>
            </Show>
          }
        >
          <div class="mt-4 space-y-3">
            <For each={skills().results}>
              {(result) => <SkillSearchCard result={result} />}
            </For>
          </div>
        </Show>
      </Section>

      <Section
        title="Installed skills"
        icon={<Plug size={15} class="text-accent" />}
      >
        <Show
          when={skills().installed.length > 0}
          fallback={
            <div class="rounded-lg border border-border bg-panel/25 px-4 py-3 text-sm text-muted">
              No skills are installed yet.
            </div>
          }
        >
          <div class="space-y-3">
            <For each={skills().installed}>
              {(skill) => (
                <InstalledSkillCard
                  skill={skill}
                  onRemove={() =>
                    sendSkillsViewAction({
                      type: "remove",
                      folder: skill.folder,
                      displayName: skill.name,
                    })
                  }
                />
              )}
            </For>
          </div>
        </Show>
      </Section>
    </div>
  );
}

function SummaryCard(props: {
  title: string;
  subtitle: string;
  accent?: string;
  onEdit: () => void;
  onDelete: () => void;
  extraAction?: { label: string; onClick: () => void; disabled?: boolean };
}) {
  return (
    <div class="rounded-lg border border-border bg-panel/40 p-4">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-medium">{props.title}</div>
          <div class="truncate text-xs text-muted">{props.subtitle}</div>
          <Show when={props.accent}>
            <div class="mt-1 truncate text-[11px] text-accent">
              {props.accent}
            </div>
          </Show>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <Show when={props.extraAction}>
            {(action) => (
              <button
                type="button"
                class={ghostButtonClass}
                disabled={action().disabled}
                onClick={action().onClick}
              >
                {action().label}
              </button>
            )}
          </Show>
          <button type="button" class={ghostButtonClass} onClick={props.onEdit}>
            <Pencil size={13} /> Edit
          </button>
          <button
            type="button"
            class={`${ghostButtonClass} text-error`}
            onClick={props.onDelete}
          >
            <Trash2 size={13} /> Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function ProviderDrawer(props: {
  provider: ConfigProviderEntryState;
  onClose: () => void;
  onSave: (fields: Record<string, string>, providerKind: ProviderKind) => void;
}) {
  const [draft, setDraft] = createSignal<Record<string, string>>({
    ...props.provider.fields,
    name: props.provider.fields.name ?? props.provider.name,
  });
  const [kind, setKind] = createSignal<ProviderKind>(props.provider.provider);
  const [errors, setErrors] = createSignal<Record<string, string>>({});

  const validate = () => {
    const next: Record<string, string> = {};
    if (!(draft().name ?? "").trim()) {
      next.name = "Name is required.";
    }
    for (const field of PROVIDER_FIELD_DEFINITIONS[kind()] ?? []) {
      const value = (draft()[field.key] ?? "").trim();
      if (field.key === "apiKey" && !value) {
        next[field.key] = `${field.label} is required.`;
      }
      if (field.kind === "optionalNumber" || field.kind === "optionalInteger") {
        if (value && Number.isNaN(Number(value))) {
          next[field.key] = `${field.label} must be a valid number.`;
        }
      }
      if (field.kind === "stringRecord" && value) {
        try {
          const parsed = JSON.parse(value) as unknown;
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            throw new Error();
          for (const item of Object.values(parsed as Record<string, unknown>)) {
            if (typeof item !== "string") throw new Error();
          }
        } catch {
          next[field.key] =
            `${field.label} must be a JSON object with string values.`;
        }
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  return (
    <Drawer
      title={`${props.provider.name ? "Edit" : "Add"} provider`}
      onClose={props.onClose}
    >
      <div class="grid gap-3 md:grid-cols-2">
        <Field label="Name" error={errors().name}>
          <input
            class={inputClassFor(errors().name)}
            value={draft().name ?? ""}
            onInput={(event) =>
              setDraft((current) => ({
                ...current,
                name: event.currentTarget.value,
              }))
            }
          />
        </Field>
        <Field label="Provider type">
          <select
            class={inputClass}
            value={kind()}
            onChange={(event) =>
              setKind(event.currentTarget.value as ProviderKind)
            }
          >
            <For each={SUPPORTED_PROVIDER_TYPES}>
              {(item) => (
                <option value={item}>{providerKindLabel(item)}</option>
              )}
            </For>
          </select>
        </Field>
        <For each={PROVIDER_FIELD_DEFINITIONS[kind()] ?? []}>
          {(field) => (
            <Field
              label={field.label}
              note={field.note}
              error={errors()[field.key]}
            >
              <input
                class={inputClassFor(errors()[field.key])}
                type={field.sensitive ? "password" : "text"}
                value={draft()[field.key] ?? ""}
                placeholder={field.placeholder}
                onInput={(event) =>
                  setDraft((current) => ({
                    ...current,
                    [field.key]: event.currentTarget.value,
                  }))
                }
              />
            </Field>
          )}
        </For>
      </div>
      <DrawerActions
        onCancel={props.onClose}
        onSave={() => validate() && props.onSave(draft(), kind())}
      />
    </Drawer>
  );
}

function LlmDrawer(props: {
  llm: ConfigLlmEntryState;
  providers: ConfigProviderEntryState[];
  onClose: () => void;
  onSave: (fields: Record<string, string>) => void;
}) {
  const [draft, setDraft] = createSignal<Record<string, string>>({
    ...props.llm.fields,
    name: props.llm.fields.name ?? props.llm.name,
    provider: props.llm.fields.provider ?? props.llm.provider,
    model: props.llm.fields.model ?? props.llm.options.model,
  });
  const [errors, setErrors] = createSignal<Record<string, string>>({});

  const validate = () => {
    const next: Record<string, string> = {};
    if (!(draft().name ?? "").trim()) next.name = "Name is required.";
    if (!(draft().provider ?? "").trim())
      next.provider = "Provider is required.";
    if (!(draft().model ?? "").trim()) next.model = "Model is required.";
    for (const field of LLM_FIELD_DEFINITIONS) {
      const value = (draft()[field.key] ?? "").trim();
      if (value && Number.isNaN(Number(value))) {
        next[field.key] = `${field.label} must be a valid number.`;
      }
    }
    for (const field of LLM_METADATA_FIELD_DEFINITIONS) {
      const value = (draft()[field.key] ?? "").trim();
      if (field.kind === "string") {
        continue;
      }
      if (field.kind === "optionalBoolean") {
        if (
          value &&
          !["true", "false", "yes", "no", "1", "0", "on", "off"].includes(
            value.toLowerCase(),
          )
        ) {
          next[field.key] = `${field.label} must be a boolean.`;
        }
        continue;
      }
      if (value && Number.isNaN(Number(value))) {
        next[field.key] = `${field.label} must be a valid number.`;
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  return (
    <Drawer
      title={`${props.llm.name ? "Edit" : "Add"} LLM`}
      onClose={props.onClose}
    >
      <div class="grid gap-3 md:grid-cols-2">
        <Field label="Name" error={errors().name}>
          <input
            class={inputClassFor(errors().name)}
            value={draft().name ?? ""}
            onInput={(event) =>
              setDraft((current) => ({
                ...current,
                name: event.currentTarget.value,
              }))
            }
          />
        </Field>
        <Field label="Provider" error={errors().provider}>
          <select
            class={inputClassFor(errors().provider)}
            value={draft().provider ?? ""}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                provider: event.currentTarget.value,
              }))
            }
          >
            <For each={props.providers}>
              {(provider) => (
                <option value={provider.name}>{provider.name}</option>
              )}
            </For>
          </select>
        </Field>
        <Field label="Model" error={errors().model}>
          <input
            class={inputClassFor(errors().model)}
            value={draft().model ?? ""}
            onInput={(event) =>
              setDraft((current) => ({
                ...current,
                model: event.currentTarget.value,
              }))
            }
          />
        </Field>
        <For each={LLM_FIELD_DEFINITIONS}>
          {(field) => (
            <Field label={field.label} error={errors()[field.key]}>
              <input
                class={inputClassFor(errors()[field.key])}
                value={draft()[field.key] ?? ""}
                placeholder={field.placeholder}
                onInput={(event) =>
                  setDraft((current) => ({
                    ...current,
                    [field.key]: event.currentTarget.value,
                  }))
                }
              />
            </Field>
          )}
        </For>
        <div class="md:col-span-2 mt-2 border-t border-border pt-3 text-xs font-semibold uppercase tracking-wide text-muted">
          Metadata overrides
        </div>
        <For each={LLM_METADATA_FIELD_DEFINITIONS}>
          {(field) => (
            <Field label={field.label} error={errors()[field.key]}>
              <input
                class={inputClassFor(errors()[field.key])}
                value={draft()[field.key] ?? ""}
                placeholder={field.placeholder}
                onInput={(event) =>
                  setDraft((current) => ({
                    ...current,
                    [field.key]: event.currentTarget.value,
                  }))
                }
              />
            </Field>
          )}
        </For>
      </div>
      <DrawerActions
        onCancel={props.onClose}
        onSave={() => validate() && props.onSave(draft())}
      />
    </Drawer>
  );
}

function McpDrawer(props: {
  server: McpServerEntryState;
  onClose: () => void;
  onSave: (
    fields: Record<string, string>,
    transportType: McpServerEntryState["transportType"],
  ) => void;
}) {
  const [draft, setDraft] = createSignal<Record<string, string>>({
    ...props.server.fields,
    name: props.server.fields.name ?? props.server.name,
  });
  const [transportType, setTransportType] = createSignal(
    props.server.transportType,
  );
  const [errors, setErrors] = createSignal<Record<string, string>>({});

  const validate = () => {
    const next: Record<string, string> = {};
    if (!(draft().name ?? "").trim()) next.name = "Name is required.";
    if (transportType() === "stdio") {
      if (!(draft().command ?? "").trim())
        next.command = "Command is required.";
      if ((draft().args ?? "").trim()) {
        try {
          const parsed = JSON.parse(draft().args ?? "[]") as unknown;
          if (
            !Array.isArray(parsed) ||
            parsed.some((item) => typeof item !== "string")
          )
            throw new Error();
        } catch {
          next.args = "Arguments must be a JSON array of strings.";
        }
      }
      if ((draft().env ?? "").trim()) {
        try {
          const parsed = JSON.parse(draft().env ?? "{}") as unknown;
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            throw new Error();
          for (const item of Object.values(parsed as Record<string, unknown>)) {
            if (typeof item !== "string") throw new Error();
          }
        } catch {
          next.env =
            "Environment variables must be a JSON object with string values.";
        }
      }
    } else {
      if (!(draft().url ?? "").trim()) next.url = "URL is required.";
      if ((draft().headers ?? "").trim()) {
        try {
          const parsed = JSON.parse(draft().headers ?? "{}") as unknown;
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
            throw new Error();
          for (const item of Object.values(parsed as Record<string, unknown>)) {
            if (typeof item !== "string") throw new Error();
          }
        } catch {
          next.headers = "Headers must be a JSON object with string values.";
        }
      }
      if (
        (draft().oauthEnabled ?? "no") !== "yes" &&
        (draft().oauthEnabled ?? "no") !== "no"
      ) {
        next.oauthEnabled = 'Enable OAuth must be "yes" or "no".';
      }
      if ((draft().oauthEnabled ?? "no") === "yes") {
        if ((draft().scopes ?? "").trim()) {
          try {
            const parsed = JSON.parse(draft().scopes ?? "[]") as unknown;
            if (
              !Array.isArray(parsed) ||
              parsed.some((item) => typeof item !== "string")
            )
              throw new Error();
          } catch {
            next.scopes = "Scopes must be a JSON array of strings.";
          }
        }
        if ((draft().audiences ?? "").trim()) {
          try {
            const parsed = JSON.parse(draft().audiences ?? "[]") as unknown;
            if (
              !Array.isArray(parsed) ||
              parsed.some((item) => typeof item !== "string")
            )
              throw new Error();
          } catch {
            next.audiences = "Audiences must be a JSON array of strings.";
          }
        }
      }
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  return (
    <Drawer
      title={`${props.server.name ? "Edit" : "Add"} MCP server`}
      onClose={props.onClose}
    >
      <div class="grid gap-3 md:grid-cols-2">
        <Field label="Name" error={errors().name}>
          <input
            class={inputClassFor(errors().name)}
            value={draft().name ?? ""}
            onInput={(event) =>
              setDraft((current) => ({
                ...current,
                name: event.currentTarget.value,
              }))
            }
          />
        </Field>
        <Field label="Transport type">
          <select
            class={inputClass}
            value={transportType()}
            onChange={(event) =>
              setTransportType(
                event.currentTarget
                  .value as McpServerEntryState["transportType"],
              )
            }
          >
            <option value="stdio">{transportTypeLabel("stdio")}</option>
            <option value="streamable-http">
              {transportTypeLabel("streamable-http")}
            </option>
            <option value="sse">{transportTypeLabel("sse")}</option>
          </select>
        </Field>
        <Show
          when={transportType() === "stdio"}
          fallback={
            <RemoteFields
              draft={draft()}
              setDraft={setDraft}
              errors={errors()}
            />
          }
        >
          <>
            <Field
              label="Command"
              error={errors().command}
              note="Executable to run, e.g. npx, node, uvx, or a local binary path."
            >
              <input
                class={inputClassFor(errors().command)}
                value={draft().command ?? ""}
                onInput={(event) =>
                  setDraft((current) => ({
                    ...current,
                    command: event.currentTarget.value,
                  }))
                }
              />
            </Field>
            <Field
              label="Arguments"
              error={errors().args}
              note='JSON array of strings, e.g. ["-y", "@modelcontextprotocol/server-filesystem", "/path"].'
            >
              <input
                class={inputClassFor(errors().args)}
                value={draft().args ?? "[]"}
                onInput={(event) =>
                  setDraft((current) => ({
                    ...current,
                    args: event.currentTarget.value,
                  }))
                }
              />
            </Field>
            <Field
              label="Environment variables"
              error={errors().env}
              note='JSON object with string values, e.g. {"API_KEY":"...","DEBUG":"1"}.'
            >
              <input
                class={inputClassFor(errors().env)}
                value={draft().env ?? ""}
                onInput={(event) =>
                  setDraft((current) => ({
                    ...current,
                    env: event.currentTarget.value,
                  }))
                }
              />
            </Field>
            <Field
              label="Working directory"
              note="Optional absolute path to run the command from."
            >
              <input
                class={inputClass}
                value={draft().cwd ?? ""}
                onInput={(event) =>
                  setDraft((current) => ({
                    ...current,
                    cwd: event.currentTarget.value,
                  }))
                }
              />
            </Field>
          </>
        </Show>
      </div>
      <DrawerActions
        onCancel={props.onClose}
        onSave={() => validate() && props.onSave(draft(), transportType())}
      />
    </Drawer>
  );
}

function RemoteFields(props: {
  draft: Record<string, string>;
  setDraft: (
    updater: (current: Record<string, string>) => Record<string, string>,
  ) => void;
  errors: Record<string, string>;
}) {
  return (
    <div class="col-span-full space-y-4">
      <Subsection
        title="Endpoint settings"
        description="Connection details for the remote MCP server."
      >
        <div class="grid gap-3 md:grid-cols-2">
          <Field
            label="URL"
            error={props.errors.url}
            note="Full streamable-http or SSE endpoint URL."
          >
            <input
              class={inputClassFor(props.errors.url)}
              value={props.draft.url ?? ""}
              onInput={(event) =>
                props.setDraft((current) => ({
                  ...current,
                  url: event.currentTarget.value,
                }))
              }
            />
          </Field>
          <Field
            label="Headers"
            error={props.errors.headers}
            note='JSON object of request headers, e.g. {"Authorization":"Bearer ..."}'
          >
            <input
              class={inputClassFor(props.errors.headers)}
              value={props.draft.headers ?? ""}
              onInput={(event) =>
                props.setDraft((current) => ({
                  ...current,
                  headers: event.currentTarget.value,
                }))
              }
            />
          </Field>
        </div>
      </Subsection>

      <Subsection
        title="OAuth"
        description="Optional OAuth configuration for remote transports."
      >
        <div class="grid gap-3 md:grid-cols-2">
          <Field
            label="Enable OAuth"
            error={props.errors.oauthEnabled}
            note='Use "yes" to enable OAuth and show client settings.'
          >
            <select
              class={inputClassFor(props.errors.oauthEnabled)}
              value={props.draft.oauthEnabled ?? "no"}
              onChange={(event) =>
                props.setDraft((current) => ({
                  ...current,
                  oauthEnabled: event.currentTarget.value,
                }))
              }
            >
              <option value="no">Disabled</option>
              <option value="yes">Enabled</option>
            </select>
          </Field>
        </div>

        <Show when={props.draft.oauthEnabled === "yes"}>
          <div class="mt-3 space-y-4">
            <Subsection
              title="Client credentials"
              description="Used when the remote server requires explicit OAuth client details."
            >
              <div class="grid gap-3 md:grid-cols-2">
                <Field label="OAuth client ID">
                  <input
                    class={inputClass}
                    value={props.draft.clientId ?? ""}
                    onInput={(event) =>
                      props.setDraft((current) => ({
                        ...current,
                        clientId: event.currentTarget.value,
                      }))
                    }
                  />
                </Field>
                <Field label="OAuth client secret">
                  <input
                    class={inputClass}
                    value={props.draft.clientSecret ?? ""}
                    onInput={(event) =>
                      props.setDraft((current) => ({
                        ...current,
                        clientSecret: event.currentTarget.value,
                      }))
                    }
                  />
                </Field>
              </div>
            </Subsection>

            <Subsection
              title="Access configuration"
              description="Optional scopes and audiences as JSON string arrays."
            >
              <div class="grid gap-3 md:grid-cols-2">
                <Field
                  label="Scopes"
                  error={props.errors.scopes}
                  note='Example: ["read", "write"]'
                >
                  <input
                    class={inputClassFor(props.errors.scopes)}
                    value={props.draft.scopes ?? "[]"}
                    onInput={(event) =>
                      props.setDraft((current) => ({
                        ...current,
                        scopes: event.currentTarget.value,
                      }))
                    }
                  />
                </Field>
                <Field
                  label="Audiences"
                  error={props.errors.audiences}
                  note='Example: ["https://api.example.com"]'
                >
                  <input
                    class={inputClassFor(props.errors.audiences)}
                    value={props.draft.audiences ?? "[]"}
                    onInput={(event) =>
                      props.setDraft((current) => ({
                        ...current,
                        audiences: event.currentTarget.value,
                      }))
                    }
                  />
                </Field>
              </div>
            </Subsection>
          </div>
        </Show>
      </Subsection>
    </div>
  );
}

function Drawer(props: {
  title: string;
  children: import("solid-js").JSX.Element;
  onClose: () => void;
}) {
  return (
    <div class="fixed inset-0 z-50 flex justify-end bg-black/40">
      <div class="flex h-full w-full max-w-2xl flex-col border-l border-border bg-[var(--vscode-editor-background)] shadow-2xl">
        <div class="flex items-center justify-between border-b border-border px-5 py-4">
          <div class="text-sm font-semibold">{props.title}</div>
          <button
            type="button"
            class="rounded-md border border-border p-1.5 hover:bg-panel"
            onClick={props.onClose}
          >
            <X size={14} />
          </button>
        </div>
        <div class="scroll-thin flex-1 overflow-y-auto px-5 py-5">
          {props.children}
        </div>
      </div>
    </div>
  );
}

function DrawerActions(props: { onCancel: () => void; onSave: () => void }) {
  return (
    <div class="mt-5 flex justify-end gap-2 border-t border-border pt-4">
      <button type="button" class={ghostButtonClass} onClick={props.onCancel}>
        Cancel
      </button>
      <button type="button" class={primaryButtonClass} onClick={props.onSave}>
        <Check size={14} /> Save
      </button>
    </div>
  );
}

function SkillSearchCard(props: { result: SkillSearchResultInfo }) {
  return (
    <div class="rounded-lg border border-border bg-panel/40 p-4">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-medium">{props.result.name}</div>
          <div class="truncate text-xs text-muted">
            {props.result.source || props.result.slug}
          </div>
          <div class="mt-1 text-[11px] text-muted">
            {props.result.installs} installs
          </div>
        </div>
        <button
          type="button"
          class={`${primaryButtonClass} shrink-0`}
          onClick={() =>
            sendSkillsViewAction({
              type: "installSearchResult",
              slug: props.result.slug,
              name: props.result.name,
            })
          }
        >
          <Plus size={14} /> Install
        </button>
      </div>
    </div>
  );
}

function InstalledSkillCard(props: {
  skill: SkillInstalledEntryInfo;
  onRemove: () => void;
}) {
  return (
    <div class="rounded-lg border border-border bg-panel/40 p-4">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-medium">{props.skill.name}</div>
          <div class="truncate text-xs text-muted">{props.skill.path}</div>
          <Show when={props.skill.description}>
            <div class="mt-1 line-clamp-3 text-sm text-muted">
              {props.skill.description}
            </div>
          </Show>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <button
            type="button"
            class={ghostButtonClass}
            onClick={() =>
              sendSkillsViewAction({
                type: "openSkill",
                path: props.skill.path,
              })
            }
          >
            Open
          </button>
          <button
            type="button"
            class={`${ghostButtonClass} text-error`}
            onClick={props.onRemove}
          >
            <Trash2 size={13} /> Remove
          </button>
        </div>
      </div>
    </div>
  );
}

function RelatedFileCard(props: {
  label: string;
  path?: string;
  onOpen: () => void;
}) {
  return (
    <div class="rounded-lg border border-border bg-panel/40 p-4">
      <div class="mb-1 text-sm font-medium">{props.label}</div>
      <div class="min-h-[2.5rem] truncate text-xs leading-5 text-muted">
        {props.path ?? "Not available"}
      </div>
      <button
        type="button"
        class={`${ghostButtonClass} mt-3`}
        disabled={!props.path}
        onClick={props.onOpen}
      >
        <ArrowUpRight size={13} /> Open related file
      </button>
    </div>
  );
}

function Section(props: {
  title: string;
  icon?: import("solid-js").JSX.Element;
  children: import("solid-js").JSX.Element;
}) {
  return (
    <section class="rounded-lg border border-border/80 bg-panel/35 p-5">
      <div class="mb-4 flex items-center gap-2 text-sm font-medium text-foreground">
        {props.icon}
        <span>{props.title}</span>
      </div>
      {props.children}
    </section>
  );
}

function Subsection(props: {
  title: string;
  description?: string;
  children: import("solid-js").JSX.Element;
}) {
  return (
    <section class="rounded-lg border border-border/70 bg-panel/25 p-4">
      <div class="mb-3">
        <div class="text-sm font-medium text-foreground">{props.title}</div>
        <Show when={props.description}>
          <div class="mt-1 text-xs leading-5 text-muted">
            {props.description}
          </div>
        </Show>
      </div>
      {props.children}
    </section>
  );
}

function Field(props: {
  label: string;
  note?: string;
  error?: string;
  children: import("solid-js").JSX.Element;
}) {
  return (
    <label class="flex flex-col gap-1.5">
      <span class="text-xs font-medium text-foreground">{props.label}</span>
      {props.children}
      <Show when={props.error}>
        <span class="text-[11px] leading-5 text-error">{props.error}</span>
      </Show>
      <Show when={!props.error && props.note}>
        <span class="text-[11px] leading-5 text-muted">{props.note}</span>
      </Show>
    </label>
  );
}

function ToggleRow(props: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      class="flex items-center justify-between rounded-lg border border-border bg-panel/30 px-3 py-2 text-sm hover:bg-panel"
      onClick={() => props.onChange(!props.checked)}
    >
      <span class="capitalize">{props.label}</span>
      <span
        class={`rounded-md px-2 py-0.5 text-[11px] ${props.checked ? "bg-button text-button-foreground" : "bg-button-secondary text-button-secondary-foreground"}`}
      >
        {props.checked ? "Enabled" : "Disabled"}
      </span>
    </button>
  );
}

/** Shared compact control height for settings toolbar rows (input + adjacent button). */
const inputClass =
  "box-border h-8 w-full rounded-md border border-input-border bg-input px-2.5 text-xs leading-none text-input-foreground outline-none focus:border-focus";
const primaryButtonClass =
  "btn btn-primary box-border h-8 shrink-0 gap-1.5 px-2.5 text-xs";
const ghostButtonClass =
  "btn btn-ghost box-border h-8 shrink-0 gap-1.5 border border-border px-2.5 text-xs hover:bg-panel";

function inputClassFor(error?: string): string {
  return error ? `${inputClass} border-error focus:border-error` : inputClass;
}

function providerKindLabel(value: ProviderKind): string {
  switch (value) {
    case "llama-cpp":
      return "Llama.cpp";
    case "openai":
      return "OpenAI";
    case "openrouter":
      return "OpenRouter";
    case "xai":
      return "xAI";
    case "mlx":
      return "MLX";
    default:
      return value
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
  }
}

function transportTypeLabel(
  value: McpServerEntryState["transportType"],
): string {
  switch (value) {
    case "stdio":
      return "STDIO";
    case "streamable-http":
      return "Streamable HTTP";
    case "sse":
      return "SSE";
  }
}

function displayMcpAuthStatus(server: McpServerEntryState): string | undefined {
  return server.authStatus === "unsupported" ? undefined : server.authStatus;
}
