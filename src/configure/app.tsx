import React, { useCallback, useEffect, useMemo, useState } from "react";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Box, Text, useApp, useInput } from "ink";
import {
  LlmProvider,
  type ConfigData,
  type NamedLlmConfig,
  type NamedProviderConfig,
} from "../core/config.js";
import {
  type McpOAuthConfig,
  McpOAuthConfigSchema,
} from "../core/mcp/oauth/types.js";
import {
  McpTransportSchema,
  type Sse,
  type Stdio,
  type StreamableHttp,
} from "../core/mcp/types.js";
import type {
  SkillListEntry,
  SkillSearchResult,
} from "../core/skills/registry.js";
import {
  basePath,
  configJsonPath,
  instructionsMdPath,
  mcpJsonPath,
  skillsPath,
} from "../core/utils/paths.js";
import { BusyScreen } from "./components/BusyScreen.js";
import { HomeScreen } from "./components/HomeScreen.js";
import { MenuScreen } from "./components/MenuScreen.js";
import { PromptForm } from "./components/PromptForm.js";
import { openFileInEditor } from "./open-in-editor.js";
import type {
  ConfigureAppProps,
  MenuItem,
  Notice,
  PromptState,
  Screen,
} from "./types.js";
import {
  DEFAULT_INSTRUCTIONS,
  compactJson,
  folderNameForSkill,
  paramsPreview,
  normalizeOptional,
  noticeColor,
  parseOptionalBoolean,
  parseNumber,
  parseObjectRecord,
  maskSensitiveParamsForDisplay,
  parseStringArray,
  parseStringRecord,
  transportSummary,
  truncate,
} from "./utils.js";

const PROMPT_LABELS: Record<keyof ConfigData["prompts"], string> = {
  behaviour: "Behaviour",
  communication: "Communication",
  execution: "Execution",
  guardrails: "Guardrails",
};

type SearchProvider = ConfigData["search"]["provider"];
type LlmEntry = NamedLlmConfig;
type ProviderEntry = NamedProviderConfig;

const SEARCH_PROVIDER_LABELS: Record<SearchProvider, string> = {
  brave: "Brave",
  exa: "Exa",
  firecrawl: "Firecrawl",
  serper: "Serper",
  tavily: "Tavily",
};

type McpAuthStatus =
  | "unsupported"
  | "authenticated"
  | "expired"
  | "unauthenticated";

const SUPPORTED_PROVIDER_TYPES = [
  LlmProvider.Anthropic,
  LlmProvider.Bedrock,
  LlmProvider.Google,
  LlmProvider.Groq,
  LlmProvider.Moonshot,
  LlmProvider.Ollama,
  LlmProvider.OpenAI,
  LlmProvider.Xai,
] as const;

function providerParamsTemplate(
  provider: (typeof SUPPORTED_PROVIDER_TYPES)[number],
): Record<string, unknown> {
  switch (provider) {
    case LlmProvider.Anthropic:
      return { apiKey: "" };
    case LlmProvider.Bedrock:
      return { region: "us-west-2" };
    case LlmProvider.Google:
      return { apiKey: "" };
    case LlmProvider.Groq:
      return { apiKey: "" };
    case LlmProvider.Moonshot:
      return { apiKey: "" };
    case LlmProvider.Ollama:
      return {};
    case LlmProvider.OpenAI:
      return { apiKey: "" };
    case LlmProvider.Xai:
      return { apiKey: "" };
  }
}

/** On/off display for tool rows (`Tool • Yes` / `Tool • No`). */
const yesNo = (on: boolean): string => (on ? "Yes" : "No");

export function ConfigureApp({
  config,
  mcpConfig,
  mcpManager,
  skills,
  onExit,
}: ConfigureAppProps): React.JSX.Element {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>({ kind: "home" });
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busyMessage, setBusyMessage] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [installedSkills, setInstalledSkills] = useState<SkillListEntry[]>([]);
  const [searchResults, setSearchResults] = useState<SkillSearchResult[]>([]);
  const [mcpAuthStatuses, setMcpAuthStatuses] = useState<
    Record<string, McpAuthStatus>
  >({});

  const refresh = useCallback(() => {
    setRevision((value) => value + 1);
  }, []);

  const runTask = useCallback(
    async (label: string, task: () => Promise<void>) => {
      setBusyMessage(label);
      try {
        await task();
      } catch (error) {
        setNotice({
          kind: "error",
          text: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setBusyMessage(null);
      }
    },
    [],
  );

  const refreshSkills = useCallback(
    async (label: string = "Loading installed skills...") => {
      await runTask(label, async () => {
        const next = await skills.list();
        setInstalledSkills(next);
      });
    },
    [runTask, skills],
  );

  useEffect(() => {
    void refreshSkills();
  }, [refreshSkills]);

  useEffect(() => {
    let cancelled = false;
    const loadStatuses = async () => {
      try {
        const rows = await mcpManager.listAuthStatuses();
        if (cancelled) {
          return;
        }
        setMcpAuthStatuses(
          Object.fromEntries(rows.map((row) => [row.name, row.status])),
        );
      } catch {
        if (!cancelled) {
          setMcpAuthStatuses({});
        }
      }
    };
    void loadStatuses();
    return () => {
      cancelled = true;
    };
  }, [mcpManager, revision]);

  const configData = useMemo(
    () =>
      ({
        name: config.name,
        providers: config.providers,
        llms: config.llms,
        search: config.search,
        prompts: config.prompts,
        tools: config.tools,
        compaction: config.compaction,
      }) satisfies ConfigData,
    [config, revision],
  );

  const mcpServers = useMemo(() => mcpConfig.list(), [mcpConfig, revision]);

  useInput(
    (input, key) => {
      if (key.ctrl && input.toLowerCase() === "c") {
        onExit();
        exit();
        return;
      }
      if (!key.escape || busyMessage) {
        return;
      }
      if (prompt) {
        prompt.onCancel?.();
        setPrompt(null);
        return;
      }
      if (screen.kind === "mcp-delete-confirm") {
        setScreen({ kind: "mcp" });
        return;
      }
      if (screen.kind === "skills-delete-confirm") {
        setScreen({ kind: "skills" });
        return;
      }
      if (screen.kind === "config-llm-delete-confirm") {
        setScreen({ kind: "config-llm-edit", name: screen.name });
        return;
      }
      if (screen.kind === "config-provider-delete-confirm") {
        setScreen({ kind: "config-provider-edit", name: screen.name });
        return;
      }
      if (screen.kind !== "home") {
        setScreen({ kind: "home" });
      }
    },
    { isActive: true },
  );

  const setSuccess = useCallback((text: string) => {
    setNotice({ kind: "success", text });
  }, []);

  const authenticateMcpServer = useCallback(
    async (name: string) => {
      await runTask(`Authenticating MCP server "${name}"...`, async () => {
        await mcpManager.authenticate(name);
        refresh();
        setSuccess(`Authenticated MCP server "${name}".`);
      });
    },
    [mcpManager, refresh, runTask, setSuccess],
  );

  const logoutMcpServer = useCallback(
    async (name: string) => {
      await runTask(`Logging out MCP server "${name}"...`, async () => {
        await mcpManager.logout(name);
        refresh();
        setSuccess(`Cleared OAuth credentials for "${name}".`);
      });
    },
    [mcpManager, refresh, runTask, setSuccess],
  );

  const updateConfig = useCallback(
    (partial: Partial<ConfigData>, message: string) => {
      config.update(partial);
      refresh();
      setSuccess(message);
    },
    [config, refresh, setSuccess],
  );

  const patchLlm = useCallback(
    (name: string, patch: Partial<LlmEntry["options"]>) =>
      config.llms.map((m) =>
        m.name === name ? { ...m, options: { ...m.options, ...patch } } : m,
      ),
    [config],
  );

  const renameLlm = useCallback(
    (oldName: string, newName: string) =>
      config.llms.map((m) =>
        m.name === oldName ? { ...m, name: newName } : m,
      ),
    [config],
  );

  const setDefaultLlm = useCallback(
    (name: string) =>
      config.llms.map((m) => ({ ...m, default: m.name === name })),
    [config],
  );

  const addLlm = useCallback(
    (name: string) => [
      ...config.llms,
      {
        name,
        options: {
          provider: config.providers[0]?.name ?? LlmProvider.Ollama,
          model: "gemma4:e4b",
          params: {} as Record<string, unknown>,
        },
        default: false,
      },
    ],
    [config],
  );

  const removeLlm = useCallback(
    (name: string) => config.llms.filter((m) => m.name !== name),
    [config],
  );

  const patchProvider = useCallback(
    (name: string, patch: Partial<ProviderEntry["options"]>) =>
      config.providers.map((provider) =>
        provider.name === name
          ? {
              ...provider,
              options: {
                ...provider.options,
                ...patch,
                params: patch.params ?? provider.options.params,
              },
            }
          : provider,
      ),
    [config],
  );

  const renameProvider = useCallback(
    (oldName: string, newName: string) => ({
      providers: config.providers.map((provider) =>
        provider.name === oldName ? { ...provider, name: newName } : provider,
      ),
      llms: config.llms.map((llm) =>
        llm.options.provider === oldName
          ? {
              ...llm,
              options: {
                ...llm.options,
                provider: newName,
              },
            }
          : llm,
      ),
    }),
    [config],
  );

  const addProvider = useCallback(
    (name: string) => [
      ...config.providers,
      {
        name,
        options: {
          provider: LlmProvider.Ollama,
          params: providerParamsTemplate(LlmProvider.Ollama),
        },
      },
    ],
    [config],
  );

  const removeProvider = useCallback(
    (name: string) =>
      config.providers.filter((provider) => provider.name !== name),
    [config],
  );

  const promptValue = useCallback((state: PromptState) => {
    setPrompt(state);
  }, []);

  const handlePromptSubmit = useCallback(
    async (value: string) => {
      if (!prompt) {
        return;
      }
      try {
        await prompt.onSubmit(value);
      } catch (error) {
        setNotice({
          kind: "error",
          text: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [prompt],
  );

  const promptForStdio = useCallback(
    (name: string, initial?: Stdio) => {
      const mode = initial ? "Edit" : "Add";
      promptValue({
        title: `${mode} stdio server`,
        label: "Command",
        initialValue: initial?.command ?? "",
        placeholder: "npx",
        onSubmit: async (commandValue) => {
          const command = commandValue.trim();
          if (!command) {
            throw new Error("Command is required.");
          }
          promptValue({
            title: `${mode} stdio server`,
            label: "Arguments",
            note: 'Example: ["-y", "@modelcontextprotocol/server-filesystem"]',
            initialValue: compactJson(initial?.args ?? []),
            placeholder: "[]",
            onSubmit: async (argsValue) => {
              const args = parseStringArray(argsValue, "Arguments");
              promptValue({
                title: `${mode} stdio server`,
                label: "Environment variables (optional)",
                initialValue: initial?.env ? compactJson(initial.env) : "",
                placeholder: '{"API_KEY":"..."}',
                onSubmit: async (envValue) => {
                  const env = parseStringRecord(
                    envValue,
                    "Environment variables",
                  );
                  promptValue({
                    title: `${mode} stdio server`,
                    label: "Working directory (optional)",
                    initialValue: initial?.cwd ?? "",
                    placeholder: "/absolute/path",
                    onSubmit: async (cwdValue) => {
                      const transport = McpTransportSchema.parse({
                        type: "stdio",
                        command,
                        ...(args.length > 0 ? { args } : {}),
                        ...(env && Object.keys(env).length > 0 ? { env } : {}),
                        ...(normalizeOptional(cwdValue)
                          ? { cwd: normalizeOptional(cwdValue) }
                          : {}),
                      }) as Stdio;
                      if (initial) {
                        mcpConfig.update(name, transport);
                        setSuccess(`Updated MCP server "${name}".`);
                      } else {
                        mcpConfig.add(name, transport);
                        setSuccess(`Added MCP server "${name}".`);
                      }
                      setPrompt(null);
                      setScreen({ kind: "mcp" });
                      refresh();
                    },
                  });
                },
              });
            },
          });
        },
      });
    },
    [mcpConfig, promptValue, refresh, setSuccess],
  );

  const promptForRemote = useCallback(
    (
      name: string,
      type: StreamableHttp["type"] | Sse["type"],
      initial?: StreamableHttp | Sse,
    ) => {
      const mode = initial ? "Edit" : "Add";
      const persistRemote = (
        url: string,
        headers: Record<string, string> | undefined,
        oauth: McpOAuthConfig | undefined,
      ) => {
        const transport = McpTransportSchema.parse({
          type,
          url,
          ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
          ...(oauth ? { oauth } : {}),
        }) as StreamableHttp | Sse;
        if (initial) {
          mcpConfig.update(name, transport);
          setSuccess(`Updated MCP server "${name}".`);
        } else {
          mcpConfig.add(name, transport);
          setSuccess(`Added MCP server "${name}".`);
        }
        setPrompt(null);
        setScreen({ kind: "mcp" });
        refresh();
      };
      const promptForOAuthDetails = (
        url: string,
        headers: Record<string, string> | undefined,
        oauthEnabled: boolean,
      ) => {
        if (!oauthEnabled) {
          persistRemote(url, headers, undefined);
          return;
        }
        promptValue({
          title: `${mode} ${type} server`,
          label: "OAuth client ID (optional)",
          initialValue: initial?.oauth?.clientId ?? "",
          placeholder: "client-id",
          onSubmit: async (clientIdValue) => {
            promptValue({
              title: `${mode} ${type} server`,
              label: "OAuth client secret (optional)",
              initialValue: initial?.oauth?.clientSecret ?? "",
              placeholder: "secret",
              note: "Stored in mcp.json only if you enter a value.",
              onSubmit: async (clientSecretValue) => {
                promptValue({
                  title: `${mode} ${type} server`,
                  label: "OAuth scopes (optional)",
                  initialValue: initial?.oauth?.scopes
                    ? compactJson(initial.oauth.scopes)
                    : "",
                  placeholder: '["read","write"]',
                  onSubmit: async (scopesValue) => {
                    promptValue({
                      title: `${mode} ${type} server`,
                      label: "OAuth audiences (optional)",
                      initialValue: initial?.oauth?.audiences
                        ? compactJson(initial.oauth.audiences)
                        : "",
                      placeholder: '["https://api.example.com"]',
                      onSubmit: async (audiencesValue) => {
                        promptValue({
                          title: `${mode} ${type} server`,
                          label: "OAuth callback port (optional)",
                          initialValue:
                            initial?.oauth?.callbackPort !== undefined
                              ? String(initial.oauth.callbackPort)
                              : "",
                          placeholder: "19876",
                          onSubmit: async (callbackPortValue) => {
                            promptValue({
                              title: `${mode} ${type} server`,
                              label: "OAuth redirect URI (optional)",
                              initialValue: initial?.oauth?.redirectUri ?? "",
                              placeholder:
                                "http://127.0.0.1:19876/mcp/oauth/callback",
                              onSubmit: async (redirectUriValue) => {
                                promptValue({
                                  title: `${mode} ${type} server`,
                                  label: "OAuth issuer (optional)",
                                  initialValue: initial?.oauth?.issuer ?? "",
                                  placeholder: "https://auth.example.com",
                                  onSubmit: async (issuerValue) => {
                                    promptValue({
                                      title: `${mode} ${type} server`,
                                      label:
                                        "OAuth authorization URL override (optional)",
                                      initialValue:
                                        initial?.oauth?.authorizationUrl ?? "",
                                      placeholder:
                                        "https://auth.example.com/authorize",
                                      onSubmit: async (
                                        authorizationUrlValue,
                                      ) => {
                                        promptValue({
                                          title: `${mode} ${type} server`,
                                          label:
                                            "OAuth token URL override (optional)",
                                          initialValue:
                                            initial?.oauth?.tokenUrl ?? "",
                                          placeholder:
                                            "https://auth.example.com/token",
                                          onSubmit: async (tokenUrlValue) => {
                                            promptValue({
                                              title: `${mode} ${type} server`,
                                              label:
                                                "OAuth registration URL override (optional)",
                                              initialValue:
                                                initial?.oauth
                                                  ?.registrationUrl ?? "",
                                              placeholder:
                                                "https://auth.example.com/register",
                                              onSubmit: async (
                                                registrationUrlValue,
                                              ) => {
                                                promptValue({
                                                  title: `${mode} ${type} server`,
                                                  label:
                                                    "OAuth token param name (optional)",
                                                  initialValue:
                                                    initial?.oauth
                                                      ?.tokenParamName ?? "",
                                                  placeholder: "access_token",
                                                  onSubmit: async (
                                                    tokenParamNameValue,
                                                  ) => {
                                                    const scopes =
                                                      parseStringArray(
                                                        scopesValue,
                                                        "OAuth scopes",
                                                      );
                                                    const audiences =
                                                      parseStringArray(
                                                        audiencesValue,
                                                        "OAuth audiences",
                                                      );
                                                    const callbackPort =
                                                      normalizeOptional(
                                                        callbackPortValue,
                                                      ) !== undefined
                                                        ? parseNumber(
                                                            callbackPortValue,
                                                            "OAuth callback port",
                                                            {
                                                              integer: true,
                                                              min: 1,
                                                              max: 65535,
                                                            },
                                                          )
                                                        : undefined;
                                                    const oauth =
                                                      McpOAuthConfigSchema.parse(
                                                        {
                                                          enabled: true,
                                                          ...(normalizeOptional(
                                                            clientIdValue,
                                                          )
                                                            ? {
                                                                clientId:
                                                                  normalizeOptional(
                                                                    clientIdValue,
                                                                  ),
                                                              }
                                                            : {}),
                                                          ...(normalizeOptional(
                                                            clientSecretValue,
                                                          )
                                                            ? {
                                                                clientSecret:
                                                                  normalizeOptional(
                                                                    clientSecretValue,
                                                                  ),
                                                              }
                                                            : {}),
                                                          ...(scopes.length > 0
                                                            ? { scopes }
                                                            : {}),
                                                          ...(audiences.length >
                                                          0
                                                            ? { audiences }
                                                            : {}),
                                                          ...(callbackPort !==
                                                          undefined
                                                            ? { callbackPort }
                                                            : {}),
                                                          ...(normalizeOptional(
                                                            redirectUriValue,
                                                          )
                                                            ? {
                                                                redirectUri:
                                                                  normalizeOptional(
                                                                    redirectUriValue,
                                                                  ),
                                                              }
                                                            : {}),
                                                          ...(normalizeOptional(
                                                            issuerValue,
                                                          )
                                                            ? {
                                                                issuer:
                                                                  normalizeOptional(
                                                                    issuerValue,
                                                                  ),
                                                              }
                                                            : {}),
                                                          ...(normalizeOptional(
                                                            authorizationUrlValue,
                                                          )
                                                            ? {
                                                                authorizationUrl:
                                                                  normalizeOptional(
                                                                    authorizationUrlValue,
                                                                  ),
                                                              }
                                                            : {}),
                                                          ...(normalizeOptional(
                                                            tokenUrlValue,
                                                          )
                                                            ? {
                                                                tokenUrl:
                                                                  normalizeOptional(
                                                                    tokenUrlValue,
                                                                  ),
                                                              }
                                                            : {}),
                                                          ...(normalizeOptional(
                                                            registrationUrlValue,
                                                          )
                                                            ? {
                                                                registrationUrl:
                                                                  normalizeOptional(
                                                                    registrationUrlValue,
                                                                  ),
                                                              }
                                                            : {}),
                                                          ...(normalizeOptional(
                                                            tokenParamNameValue,
                                                          )
                                                            ? {
                                                                tokenParamName:
                                                                  normalizeOptional(
                                                                    tokenParamNameValue,
                                                                  ),
                                                              }
                                                            : {}),
                                                        },
                                                      );
                                                    persistRemote(
                                                      url,
                                                      headers,
                                                      oauth,
                                                    );
                                                  },
                                                });
                                              },
                                            });
                                          },
                                        });
                                      },
                                    });
                                  },
                                });
                              },
                            });
                          },
                        });
                      },
                    });
                  },
                });
              },
            });
          },
        });
      };
      promptValue({
        title: `${mode} ${type} server`,
        label: "URL",
        initialValue: initial?.url ?? "",
        placeholder: "https://example.com/mcp",
        onSubmit: async (urlValue) => {
          const url = urlValue.trim();
          if (!url) {
            throw new Error("URL is required.");
          }
          promptValue({
            title: `${mode} ${type} server`,
            label: "Headers (optional)",
            initialValue: initial?.headers ? compactJson(initial.headers) : "",
            placeholder: '{"Authorization":"Bearer ..."}',
            onSubmit: async (headersValue) => {
              const headers = parseStringRecord(headersValue, "Headers");
              promptValue({
                title: `${mode} ${type} server`,
                label: "Enable OAuth? (yes/no)",
                initialValue: initial?.oauth ? "yes" : "no",
                placeholder: "no",
                note: "Choose yes for servers that use OAuth 2.0/2.1 or dynamic client registration.",
                onSubmit: async (oauthEnabledValue) => {
                  const oauthEnabled = parseOptionalBoolean(
                    oauthEnabledValue,
                    "Enable OAuth",
                  );
                  promptForOAuthDetails(url, headers, oauthEnabled);
                },
              });
            },
          });
        },
      });
    },
    [mcpConfig, promptValue, refresh, setSuccess],
  );

  const promptForServerName = useCallback(
    (type: "stdio" | "streamable-http" | "sse") => {
      promptValue({
        title: `Add ${type} server`,
        label: "Server name",
        placeholder: "filesystem",
        onSubmit: async (nameValue) => {
          const name = nameValue.trim();
          if (!name) {
            throw new Error("Server name is required.");
          }
          if (type === "stdio") {
            promptForStdio(name);
            return;
          }
          promptForRemote(name, type);
        },
      });
    },
    [promptForRemote, promptForStdio, promptValue],
  );

  const llmSummary = useCallback(
    (entry: LlmEntry): string => {
      const compactModelId = (model: string): string => {
        if (model.length <= 23) {
          return model;
        }
        return `${model.slice(0, 10)}...${model.slice(-10)}`;
      };
      const resolved = config.resolveLlm(entry.name);
      if (!resolved) {
        return `${entry.options.provider}/${compactModelId(entry.options.model)}`;
      }
      return `${entry.options.provider} -> ${resolved.options.provider}/${compactModelId(resolved.options.model)}`;
    },
    [config],
  );

  const providerUsageCount = useCallback(
    (name: string): number =>
      config.llms.filter((llm) => llm.options.provider === name).length,
    [config],
  );

  const renderHome = () => {
    const items: MenuItem[] = [
      {
        label: `Inference • ${llmSummary(
          config.llms.find((m) => m.default) ?? config.llms[0]!,
        )}`,
        value: () => setScreen({ kind: "config" }),
      },
      {
        label: "Instructions • edit instructions.md",
        value: () => {
          try {
            const path = instructionsMdPath();
            const current = existsSync(path)
              ? readFileSync(path, "utf8")
              : DEFAULT_INSTRUCTIONS;
            const next = openFileInEditor(path, current).trim();
            if (!next) {
              throw new Error("instructions.md cannot be empty.");
            }
            writeFileSync(path, `${next}\n`, "utf8");
            setSuccess("Updated instructions.md.");
          } catch (error) {
            setNotice({
              kind: "error",
              text: error instanceof Error ? error.message : String(error),
            });
          }
        },
      },
      {
        label: `MCP servers • ${mcpServers.length} configured`,
        value: () => setScreen({ kind: "mcp" }),
      },
      {
        label: `Skills • ${installedSkills.length} installed`,
        value: () => setScreen({ kind: "skills" }),
      },
      {
        label: "Exit",
        value: () => {
          onExit();
          exit();
        },
      },
    ];
    return (
      <HomeScreen
        rootPath={basePath()}
        configPath={configJsonPath()}
        instructionsPath={instructionsMdPath()}
        mcpPath={mcpJsonPath()}
        skillsPath={skillsPath()}
        items={items}
      />
    );
  };

  const renderConfigMenu = () => {
    const enabledPrompts = Object.values(configData.prompts).filter(
      Boolean,
    ).length;
    const totalPrompts = Object.keys(configData.prompts).length;
    const items: MenuItem[] = [
      {
        label: `Name • ${configData.name}`,
        value: () =>
          promptValue({
            title: "Update app name",
            label: "Name",
            initialValue: configData.name,
            onSubmit: async (value) => {
              const next = value.trim();
              if (!next) {
                throw new Error("Name is required.");
              }
              updateConfig({ name: next }, "Updated app name.");
              setPrompt(null);
            },
          }),
      },
      {
        label: (() => {
          const def = config.llms.find((m) => m.default) ?? config.llms[0]!;
          return `LLMs • ${config.llms.length} configured (default: ${def.name})`;
        })(),
        value: () => setScreen({ kind: "config-llms" }),
      },
      {
        label: `Providers • ${config.providers.length} configured`,
        value: () => setScreen({ kind: "config-providers" }),
      },
      {
        label: `Prompts • ${enabledPrompts}/${totalPrompts} enabled`,
        value: () => setScreen({ kind: "config-prompts" }),
      },
      {
        label: "Tools • configure enabled tools",
        value: () => setScreen({ kind: "config-tools" }),
      },
      {
        label: `Compaction ratio • ${configData.compaction.ratio}`,
        value: () =>
          promptValue({
            title: "Update compaction ratio",
            label: "Ratio",
            initialValue: String(configData.compaction.ratio),
            onSubmit: async (value) => {
              const ratio = parseNumber(value, "Compaction ratio", {
                min: 0,
                max: 1,
              });
              updateConfig(
                {
                  compaction: {
                    ...config.compaction,
                    ratio,
                  },
                },
                "Updated compaction ratio.",
              );
              setPrompt(null);
            },
          }),
      },
      {
        label: `Compaction keep • ${configData.compaction.keep}`,
        value: () =>
          promptValue({
            title: "Update compaction keep",
            label: "Keep",
            initialValue: String(configData.compaction.keep),
            onSubmit: async (value) => {
              const keep = parseNumber(value, "Compaction keep", {
                min: 0,
                integer: true,
              });
              updateConfig(
                {
                  compaction: {
                    ...config.compaction,
                    keep,
                  },
                },
                "Updated compaction keep.",
              );
              setPrompt(null);
            },
          }),
      },
      {
        label: "Back",
        value: () => setScreen({ kind: "home" }),
      },
    ];

    return (
      <MenuScreen
        title="Configuration"
        description="Edit the same values loaded from ~/.hooman/config.json."
        items={items}
      />
    );
  };

  const renderToolsConfigMenu = () => {
    const items: MenuItem[] = [
      {
        label: `Search tool • ${yesNo(configData.search.enabled)} • ${SEARCH_PROVIDER_LABELS[configData.search.provider]}`,
        value: () => setScreen({ kind: "config-search" }),
      },
      {
        label: `Todo tool • ${yesNo(configData.tools.todo.enabled)}`,
        value: () => {
          updateConfig(
            {
              tools: {
                ...config.tools,
                todo: {
                  enabled: !configData.tools.todo.enabled,
                },
              },
            },
            `Todo tool ${configData.tools.todo.enabled ? "disabled" : "enabled"}.`,
          );
          setScreen({ kind: "config-tools" });
        },
      },
      {
        label: `Fetch tool • ${yesNo(configData.tools.fetch.enabled)}`,
        value: () => {
          updateConfig(
            {
              tools: {
                ...config.tools,
                fetch: {
                  enabled: !configData.tools.fetch.enabled,
                },
              },
            },
            `Fetch tool ${configData.tools.fetch.enabled ? "disabled" : "enabled"}.`,
          );
          setScreen({ kind: "config-tools" });
        },
      },
      {
        label: `Filesystem tool • ${yesNo(configData.tools.filesystem.enabled)}`,
        value: () => {
          updateConfig(
            {
              tools: {
                ...config.tools,
                filesystem: {
                  enabled: !configData.tools.filesystem.enabled,
                },
              },
            },
            `Filesystem tool ${configData.tools.filesystem.enabled ? "disabled" : "enabled"}.`,
          );
          setScreen({ kind: "config-tools" });
        },
      },
      {
        label: `Shell tool • ${yesNo(configData.tools.shell.enabled)}`,
        value: () => {
          updateConfig(
            {
              tools: {
                ...config.tools,
                shell: {
                  enabled: !configData.tools.shell.enabled,
                },
              },
            },
            `Shell tool ${configData.tools.shell.enabled ? "disabled" : "enabled"}.`,
          );
          setScreen({ kind: "config-tools" });
        },
      },
      {
        label: `Sleep tool • ${yesNo(configData.tools.sleep.enabled)}`,
        value: () => {
          updateConfig(
            {
              tools: {
                ...config.tools,
                sleep: {
                  enabled: !configData.tools.sleep.enabled,
                },
              },
            },
            `Sleep tool ${configData.tools.sleep.enabled ? "disabled" : "enabled"}.`,
          );
          setScreen({ kind: "config-tools" });
        },
      },
      {
        label: `Subagents tool • ${yesNo(configData.tools.agents.enabled)}`,
        value: () => {
          updateConfig(
            {
              tools: {
                ...config.tools,
                agents: {
                  ...config.tools.agents,
                  enabled: !configData.tools.agents.enabled,
                },
              },
            },
            `Subagents tool ${configData.tools.agents.enabled ? "disabled" : "enabled"}.`,
          );
          setScreen({ kind: "config-tools" });
        },
      },
      {
        label: "Back",
        value: () => setScreen({ kind: "config" }),
      },
    ];

    return (
      <MenuScreen
        title="Tools"
        description="Enable, disable, and configure built-in tools."
        items={items}
      />
    );
  };

  const renderProvidersMenu = () => {
    const providerItems: MenuItem[] = config.providers.map((provider) => ({
      key: `provider:${provider.name}`,
      label: `${provider.name} • ${provider.options.provider} • ${providerUsageCount(provider.name)} model(s)`,
      boldSubstring: provider.name,
      value: () =>
        setScreen({ kind: "config-provider-edit", name: provider.name }),
    }));

    const items: MenuItem[] = [
      {
        label: "Add provider",
        value: () =>
          promptValue({
            title: "Add a new provider",
            label: "Name",
            placeholder: "openai-prod",
            onSubmit: async (value) => {
              const name = value.trim();
              if (!name) {
                throw new Error("Name is required.");
              }
              if (config.providers.some((provider) => provider.name === name)) {
                throw new Error(`A provider named "${name}" already exists.`);
              }
              updateConfig(
                { providers: addProvider(name) },
                `Added provider "${name}" with an Ollama scaffold.`,
              );
              setPrompt(null);
              setScreen({ kind: "config-provider-edit", name });
            },
          }),
      },
      ...providerItems,
      {
        label: "Back",
        value: () => setScreen({ kind: "config" }),
      },
    ];

    return (
      <MenuScreen
        title="Providers"
        description="Configure reusable provider credentials and shared params."
        items={items}
      />
    );
  };

  const renderProviderEditMenu = () => {
    if (screen.kind !== "config-provider-edit") {
      return null;
    }
    const { name } = screen;
    const entry = config.providers.find((provider) => provider.name === name);
    if (!entry) {
      return null;
    }
    const usageCount = providerUsageCount(entry.name);

    const items: MenuItem[] = [
      {
        label: `Name • ${entry.name}`,
        value: () =>
          promptValue({
            title: "Rename provider",
            label: "Name",
            initialValue: entry.name,
            onSubmit: async (value) => {
              const next = value.trim();
              if (!next) {
                throw new Error("Name is required.");
              }
              if (next === entry.name) {
                setPrompt(null);
                return;
              }
              if (config.providers.some((provider) => provider.name === next)) {
                throw new Error(`A provider named "${next}" already exists.`);
              }
              updateConfig(
                renameProvider(entry.name, next),
                `Renamed provider "${entry.name}" to "${next}".`,
              );
              setPrompt(null);
              setScreen({ kind: "config-provider-edit", name: next });
            },
          }),
      },
      {
        label: `Type • ${entry.options.provider}`,
        value: () =>
          setScreen({ kind: "config-provider-type", name: entry.name }),
      },
      {
        label: `Params • ${paramsPreview(entry.options.params)}`,
        value: () =>
          promptValue({
            title: "Update provider params",
            label: "Parameters",
            initialValue: compactJson(entry.options.params),
            placeholder: '{"apiKey":"..."}',
            onSubmit: async (value) => {
              const params = parseObjectRecord(value, "Provider params");
              updateConfig(
                { providers: patchProvider(entry.name, { params }) },
                "Updated provider params.",
              );
              setPrompt(null);
            },
          }),
      },
      ...(usageCount > 0
        ? []
        : [
            {
              label: `Delete "${entry.name}"`,
              boldSubstring: entry.name,
              value: () =>
                setScreen({
                  kind: "config-provider-delete-confirm",
                  name: entry.name,
                }),
            } satisfies MenuItem,
          ]),
      {
        label: "Back",
        value: () => setScreen({ kind: "config-providers" }),
      },
    ];

    return (
      <MenuScreen
        title={`Edit Provider • ${entry.name}`}
        description={
          usageCount > 0
            ? `Used by ${usageCount} model(s). Rename updates references automatically; delete is disabled while in use.`
            : "Edit shared provider settings or delete this provider."
        }
        items={items}
      />
    );
  };

  const renderProviderTypeMenu = () => {
    if (screen.kind !== "config-provider-type") {
      return null;
    }
    const { name } = screen;
    const entry = config.providers.find((provider) => provider.name === name);
    if (!entry) {
      return null;
    }
    const items: MenuItem[] = [
      ...SUPPORTED_PROVIDER_TYPES.map((provider) => ({
        label:
          provider === entry.options.provider
            ? `${provider} • current`
            : provider,
        value: () => {
          updateConfig(
            {
              providers: patchProvider(entry.name, {
                provider,
                params: providerParamsTemplate(provider),
              }),
            },
            `Updated provider type for "${entry.name}" to "${provider}" and scaffolded params.`,
          );
          setScreen({ kind: "config-provider-edit", name: entry.name });
        },
      })),
      {
        label: "Back",
        value: () =>
          setScreen({ kind: "config-provider-edit", name: entry.name }),
      },
    ];

    return (
      <MenuScreen
        title={`Choose Provider Type • ${entry.name}`}
        description="Pick which runtime provider this shared config targets."
        items={items}
      />
    );
  };

  const renderProviderDeleteConfirm = () => {
    if (screen.kind !== "config-provider-delete-confirm") {
      return null;
    }
    const { name } = screen;
    const items: MenuItem[] = [
      {
        key: `provider-del-cancel:${name}`,
        label: "No — keep provider",
        value: () => setScreen({ kind: "config-provider-edit", name }),
      },
      {
        key: `provider-del-confirm:${name}`,
        label: "Yes — remove provider",
        value: () => {
          updateConfig(
            { providers: removeProvider(name) },
            `Deleted provider "${name}".`,
          );
          setScreen({ kind: "config-providers" });
        },
      },
    ];

    return (
      <MenuScreen
        title="Delete provider?"
        description={`Remove "${name}" from the configured providers?`}
        items={items}
      />
    );
  };

  const renderLlmsMenu = () => {
    const llmItems: MenuItem[] = config.llms.map((m) => ({
      key: `llm:${m.name}`,
      label: `${m.name} • ${llmSummary(m)}${m.default ? " • default" : ""}`,
      boldSubstring: m.name,
      value: () => setScreen({ kind: "config-llm-edit", name: m.name }),
    }));

    const items: MenuItem[] = [
      {
        label: "Add LLM",
        value: () =>
          promptValue({
            title: "Add a new LLM",
            label: "Name",
            placeholder: "Gemma 27B",
            onSubmit: async (value) => {
              const name = value.trim();
              if (!name) {
                throw new Error("Name is required.");
              }
              if (config.llms.some((m) => m.name === name)) {
                throw new Error(`An LLM named "${name}" already exists.`);
              }
              if (config.providers.length === 0) {
                throw new Error(
                  "Add at least one provider first so the model can reference it.",
                );
              }
              updateConfig({ llms: addLlm(name) }, `Added LLM "${name}".`);
              setPrompt(null);
              setScreen({ kind: "config-llm-edit", name });
            },
          }),
      },
      ...llmItems,
      {
        label: "Back",
        value: () => setScreen({ kind: "config" }),
      },
    ];

    return (
      <MenuScreen
        title="LLMs"
        description="Add, edit, or remove named LLM configurations. The default is used for new sessions."
        items={items}
      />
    );
  };

  const renderLlmEditMenu = () => {
    if (screen.kind !== "config-llm-edit") {
      return null;
    }
    const { name } = screen;
    const entry = config.llms.find((m) => m.name === name);
    if (!entry) {
      return null;
    }
    const isOnly = config.llms.length === 1;
    const isDefault = entry.default;

    const items: MenuItem[] = [
      {
        label: `Name • ${entry.name}`,
        value: () =>
          promptValue({
            title: "Rename LLM",
            label: "Name",
            initialValue: entry.name,
            onSubmit: async (value) => {
              const next = value.trim();
              if (!next) {
                throw new Error("Name is required.");
              }
              if (next === entry.name) {
                setPrompt(null);
                return;
              }
              if (config.llms.some((m) => m.name === next)) {
                throw new Error(`An LLM named "${next}" already exists.`);
              }
              updateConfig(
                { llms: renameLlm(entry.name, next) },
                `Renamed "${entry.name}" to "${next}".`,
              );
              setPrompt(null);
              setScreen({ kind: "config-llm-edit", name: next });
            },
          }),
      },
      {
        label: `Provider • ${entry.options.provider}`,
        value: () =>
          setScreen({ kind: "config-llm-provider", name: entry.name }),
      },
      {
        label: `Model • ${entry.options.model}`,
        value: () =>
          promptValue({
            title: "Update model id",
            label: "Model",
            initialValue: entry.options.model,
            onSubmit: async (value) => {
              const model = value.trim();
              if (!model) {
                throw new Error("Model is required.");
              }
              updateConfig(
                { llms: patchLlm(entry.name, { model }) },
                "Updated model id.",
              );
              setPrompt(null);
            },
          }),
      },
      {
        label: `Params • ${paramsPreview(entry.options.params)}`,
        value: () =>
          promptValue({
            title: "Update LLM params",
            label: "Parameters",
            initialValue: compactJson(entry.options.params),
            placeholder: '{"temperature":0.7}',
            onSubmit: async (value) => {
              const params = parseObjectRecord(value, "LLM params");
              updateConfig(
                { llms: patchLlm(entry.name, { params }) },
                "Updated LLM params.",
              );
              setPrompt(null);
            },
          }),
      },
      {
        label: isDefault ? "Default • yes" : "Set as default",
        value: () => {
          if (isDefault) {
            return;
          }
          updateConfig(
            { llms: setDefaultLlm(entry.name) },
            `Set "${entry.name}" as default LLM.`,
          );
        },
      },
      ...(isOnly || isDefault
        ? []
        : [
            {
              label: `Delete "${entry.name}"`,
              boldSubstring: entry.name,
              value: () =>
                setScreen({
                  kind: "config-llm-delete-confirm",
                  name: entry.name,
                }),
            } satisfies MenuItem,
          ]),
      {
        label: "Back",
        value: () => setScreen({ kind: "config-llms" }),
      },
    ];

    return (
      <MenuScreen
        title={`Edit LLM • ${entry.name}`}
        description={
          isOnly
            ? "This is the only LLM and cannot be deleted."
            : isDefault
              ? "This is the default LLM. Set another as default to enable deletion."
              : "Edit fields, set as default, or delete this LLM."
        }
        items={items}
      />
    );
  };

  const renderLlmProviderMenu = () => {
    if (screen.kind !== "config-llm-provider") {
      return null;
    }
    const { name } = screen;
    const entry = config.llms.find((m) => m.name === name);
    if (!entry) {
      return null;
    }
    const items: MenuItem[] = [
      ...config.providers.map((provider) => ({
        label:
          provider.name === entry.options.provider
            ? `${provider.name} • current`
            : `${provider.name} • ${provider.options.provider}`,
        value: () => {
          updateConfig(
            { llms: patchLlm(entry.name, { provider: provider.name }) },
            `Updated provider for "${entry.name}" to "${provider.name}".`,
          );
          setScreen({ kind: "config-llm-edit", name: entry.name });
        },
      })),
      {
        label: "Back",
        value: () => setScreen({ kind: "config-llm-edit", name: entry.name }),
      },
    ];

    return (
      <MenuScreen
        title={`Choose Provider • ${entry.name}`}
        description="Pick which shared provider config this LLM should use."
        items={items}
      />
    );
  };

  const renderLlmDeleteConfirm = () => {
    if (screen.kind !== "config-llm-delete-confirm") {
      return null;
    }
    const { name } = screen;
    const items: MenuItem[] = [
      {
        key: `llm-del-cancel:${name}`,
        label: "No — keep LLM",
        value: () => setScreen({ kind: "config-llm-edit", name }),
      },
      {
        key: `llm-del-confirm:${name}`,
        label: "Yes — remove LLM",
        value: () => {
          updateConfig({ llms: removeLlm(name) }, `Deleted LLM "${name}".`);
          setScreen({ kind: "config-llms" });
        },
      },
    ];

    return (
      <MenuScreen
        title="Delete LLM?"
        description={`Remove "${name}" from the configured LLMs?`}
        items={items}
      />
    );
  };

  const renderPromptsConfigMenu = () => {
    const promptKeys = Object.keys(
      PROMPT_LABELS,
    ) as (keyof ConfigData["prompts"])[];
    const items: MenuItem[] = [
      ...promptKeys.map((key) => {
        const enabled = configData.prompts[key];
        const label = PROMPT_LABELS[key];
        return {
          label: `${label} • ${yesNo(enabled)}`,
          value: () => {
            updateConfig(
              {
                prompts: {
                  ...config.prompts,
                  [key]: !enabled,
                },
              },
              `${label} prompt ${enabled ? "disabled" : "enabled"}.`,
            );
            setScreen({ kind: "config-prompts" });
          },
        };
      }),
      {
        label: "Back",
        value: () => setScreen({ kind: "config-tools" }),
      },
    ];

    return (
      <MenuScreen
        title="Prompts"
        description="Choose which bundled harness prompt sections are included in future sessions."
        items={items}
      />
    );
  };

  const renderSearchProviderMenu = () => {
    const items: MenuItem[] = [
      ...(["brave", "exa", "firecrawl", "serper", "tavily"] as const).map(
        (provider) => ({
          label:
            provider === configData.search.provider
              ? `${SEARCH_PROVIDER_LABELS[provider]} • current`
              : SEARCH_PROVIDER_LABELS[provider],
          value: () => {
            updateConfig(
              {
                search: {
                  ...config.search,
                  provider,
                },
              },
              `Updated search provider to "${SEARCH_PROVIDER_LABELS[provider]}".`,
            );
            setScreen({ kind: "config-search" });
          },
        }),
      ),
      {
        label: "Back",
        value: () => setScreen({ kind: "config-search" }),
      },
    ];

    return (
      <MenuScreen
        title="Search Provider"
        description="Pick which web search provider to use."
        items={items}
      />
    );
  };

  const renderSearchConfigMenu = () => {
    const activeProvider = configData.search.provider;
    const activeProviderLabel = SEARCH_PROVIDER_LABELS[activeProvider];
    const apiKey = configData.search[activeProvider].apiKey;
    const redacted = compactJson(
      maskSensitiveParamsForDisplay({ apiKey: apiKey ?? "" }),
    );
    const items: MenuItem[] = [
      {
        label: `Enabled • ${yesNo(configData.search.enabled)}`,
        value: () => {
          updateConfig(
            {
              search: {
                ...config.search,
                enabled: !configData.search.enabled,
              },
            },
            `Search tool ${configData.search.enabled ? "disabled" : "enabled"}.`,
          );
          setScreen({ kind: "config-search" });
        },
      },
      {
        label: `Provider • ${activeProviderLabel}`,
        value: () => setScreen({ kind: "config-search-provider" }),
      },
      {
        label: `${activeProviderLabel} API key • ${truncate(redacted, 44)}`,
        value: () =>
          promptValue({
            title: `Update ${activeProviderLabel} API key`,
            label: "API key",
            initialValue: apiKey ?? "",
            onSubmit: async (value) => {
              const nextApiKey = value.trim();
              if (!nextApiKey) {
                throw new Error("API key is required.");
              }
              updateConfig(
                {
                  search: {
                    ...config.search,
                    [activeProvider]: {
                      ...config.search[activeProvider],
                      apiKey: nextApiKey,
                    },
                  },
                },
                `Updated ${activeProviderLabel} API key.`,
              );
              setPrompt(null);
            },
          }),
      },
      {
        label: "Back",
        value: () => setScreen({ kind: "config-tools" }),
      },
    ];

    return (
      <MenuScreen
        title="Search"
        description="Configure web search provider and credentials."
        items={items}
      />
    );
  };

  const renderMcpMenu = () => {
    const serverItems: MenuItem[] = mcpServers.map((server) => {
      const oauthStatus = mcpAuthStatuses[server.name];
      return {
        key: `mcp-server:${server.name}`,
        label: `Edit ${server.name} • ${formatMcpServerLabel(
          server.transport,
          oauthStatus,
        )}`,
        boldSubstring: server.name,
        oauthStatus:
          oauthStatus === "authenticated" ||
          oauthStatus === "expired" ||
          oauthStatus === "unauthenticated"
            ? oauthStatus
            : undefined,
        value: () => {
          if (server.transport.type === "stdio") {
            promptForStdio(server.name, server.transport);
          } else {
            promptForRemote(
              server.name,
              server.transport.type,
              server.transport,
            );
          }
        },
      };
    });

    const items: MenuItem[] = [
      {
        label: "Add stdio server",
        value: () => promptForServerName("stdio"),
      },
      {
        label: "Add streamable HTTP server",
        value: () => promptForServerName("streamable-http"),
      },
      {
        label: "Add SSE server",
        value: () => promptForServerName("sse"),
      },
      ...serverItems,
      {
        label: "Reload from disk",
        value: () => {
          mcpConfig.reload();
          refresh();
          setNotice({ kind: "info", text: "Reloaded MCP config from disk." });
        },
      },
      {
        label: "Back",
        value: () => setScreen({ kind: "home" }),
      },
    ];

    return (
      <MenuScreen
        title="MCP Servers"
        description="Add, edit, or remove named MCP transports from ~/.hooman/mcp.json."
        items={items}
        footerHint={(item) =>
          formatMcpFooterHint(item, mcpServers, mcpAuthStatuses)
        }
        onShortcut={async (input, item) => {
          const server = findMcpServerFromMenuItem(item, mcpServers);
          if (!server) {
            return;
          }
          const status = mcpAuthStatuses[server.name];
          const key = input.toLowerCase();
          if (key === "d") {
            setScreen({ kind: "mcp-delete-confirm", name: server.name });
            return;
          }
          if (
            key === "r" &&
            server.transport.type !== "stdio" &&
            status !== "unsupported"
          ) {
            await authenticateMcpServer(server.name);
            return;
          }
          if (
            key === "l" &&
            server.transport.type !== "stdio" &&
            (status === "authenticated" || status === "expired")
          ) {
            await logoutMcpServer(server.name);
          }
        }}
      />
    );
  };

  const renderSkillsMenu = () => {
    const skillItems: MenuItem[] = installedSkills.map((skill) => {
      const folder = folderNameForSkill(skill);
      return {
        label: `Remove ${skill.name} • ${folder}`,
        boldSubstring: skill.name,
        value: () =>
          setScreen({
            kind: "skills-delete-confirm",
            folder,
            displayName: skill.name,
          }),
      };
    });

    const items: MenuItem[] = [
      {
        label: "Search catalog and install",
        value: () =>
          promptValue({
            title: "Search skills catalog",
            label: "Query",
            placeholder: "github, playwright, slack...",
            onSubmit: async (value) => {
              const query = value.trim();
              if (query.length < 2) {
                throw new Error("Use at least 2 characters to search.");
              }
              setPrompt(null);
              await runTask(`Searching for "${query}"...`, async () => {
                const results = await skills.search(query);
                setSearchResults(results);
                setScreen({ kind: "skills-search-results", query });
                setNotice({
                  kind: "info",
                  text: `Found ${results.length} result${results.length === 1 ? "" : "s"} for "${query}".`,
                });
              });
            },
          }),
      },
      {
        label: "Install from source",
        value: () =>
          promptValue({
            title: "Install skill from source",
            label: "Source",
            placeholder: "owner/repo, GitHub URL, or local path",
            onSubmit: async (value) => {
              const source = value.trim();
              if (!source) {
                throw new Error("Source is required.");
              }
              setPrompt(null);
              await runTask(`Installing ${source}...`, async () => {
                await skills.install(source);
                await refreshSkills("Refreshing installed skills...");
                setSuccess(`Installed skill from "${source}".`);
              });
            },
          }),
      },
      ...skillItems,
      {
        label: "Refresh installed skills",
        value: () => {
          void refreshSkills("Refreshing installed skills...");
        },
      },
      {
        label: "Back",
        value: () => setScreen({ kind: "home" }),
      },
    ];

    return (
      <MenuScreen
        title="Skills"
        description="Search, install, and remove skills under ~/.hooman/skills."
        items={items}
      />
    );
  };

  const renderMcpDeleteConfirm = () => {
    if (screen.kind !== "mcp-delete-confirm") {
      return null;
    }
    const { name } = screen;
    const items: MenuItem[] = [
      {
        key: `mcp-del-cancel:${name}`,
        label: "No — keep server",
        value: () => setScreen({ kind: "mcp" }),
      },
      {
        key: `mcp-del-confirm:${name}`,
        label: "Yes — remove from mcp.json",
        value: () => {
          try {
            mcpConfig.remove(name);
            refresh();
            setSuccess(`Deleted MCP server "${name}".`);
          } catch (error) {
            setNotice({
              kind: "error",
              text: error instanceof Error ? error.message : String(error),
            });
          }
          setScreen({ kind: "mcp" });
        },
      },
    ];

    return (
      <MenuScreen
        title="Delete MCP server?"
        description={`Remove "${name}" from ~/.hooman/mcp.json? This cannot be undone from here.`}
        items={items}
      />
    );
  };

  const renderSkillsDeleteConfirm = () => {
    if (screen.kind !== "skills-delete-confirm") {
      return null;
    }
    const { folder, displayName } = screen;
    const items: MenuItem[] = [
      {
        key: `skill-del-cancel:${folder}`,
        label: "No — keep skill",
        value: () => setScreen({ kind: "skills" }),
      },
      {
        key: `skill-del-confirm:${folder}`,
        label: "Yes — uninstall",
        value: async () => {
          await runTask(`Removing ${displayName}...`, async () => {
            await skills.delete(folder);
            await refreshSkills("Refreshing installed skills...");
            setSuccess(`Removed skill "${displayName}".`);
          });
          setScreen({ kind: "skills" });
        },
      },
    ];

    return (
      <MenuScreen
        title="Remove skill?"
        description={`Uninstall "${displayName}" (${folder}) from ~/.hooman/skills?`}
        items={items}
      />
    );
  };

  const renderSearchResults = () => {
    const items: MenuItem[] = [
      ...searchResults.map((result) => ({
        label: truncate(
          `${result.name} • ${result.installs} installs • ${result.source || result.slug}`,
          100,
        ),
        boldSubstring: result.name,
        value: () => {
          const source = result.slug || result.source;
          void runTask(`Installing ${result.name}...`, async () => {
            await skills.install(source);
            await refreshSkills("Refreshing installed skills...");
            setScreen({ kind: "skills" });
            setSuccess(`Installed "${result.name}".`);
          });
        },
      })),
      {
        label: "Back",
        value: () => setScreen({ kind: "skills" }),
      },
    ];

    return (
      <MenuScreen
        title={`Search Results • "${screen.kind === "skills-search-results" ? screen.query : ""}"`}
        description="Select a result to install it."
        items={items}
      />
    );
  };

  const body = (() => {
    if (busyMessage) {
      return <BusyScreen message={busyMessage} />;
    }
    if (prompt) {
      return <PromptForm prompt={prompt} onSubmit={handlePromptSubmit} />;
    }
    switch (screen.kind) {
      case "home":
        return renderHome();
      case "config":
        return renderConfigMenu();
      case "config-providers":
        return renderProvidersMenu();
      case "config-provider-edit":
        return renderProviderEditMenu();
      case "config-provider-type":
        return renderProviderTypeMenu();
      case "config-provider-delete-confirm":
        return renderProviderDeleteConfirm();
      case "config-llms":
        return renderLlmsMenu();
      case "config-llm-edit":
        return renderLlmEditMenu();
      case "config-llm-provider":
        return renderLlmProviderMenu();
      case "config-llm-delete-confirm":
        return renderLlmDeleteConfirm();
      case "config-prompts":
        return renderPromptsConfigMenu();
      case "config-tools":
        return renderToolsConfigMenu();
      case "config-search":
        return renderSearchConfigMenu();
      case "config-search-provider":
        return renderSearchProviderMenu();
      case "mcp":
        return renderMcpMenu();
      case "mcp-delete-confirm":
        return renderMcpDeleteConfirm();
      case "skills":
        return renderSkillsMenu();
      case "skills-delete-confirm":
        return renderSkillsDeleteConfirm();
      case "skills-search-results":
        return renderSearchResults();
      default:
        return null;
    }
  })();

  return (
    <Box flexDirection="column" width="100%" paddingX={1}>
      {notice ? (
        <Box marginTop={1}>
          <Text color={noticeColor(notice.kind)}>{notice.text}</Text>
        </Box>
      ) : null}

      <Box marginTop={1}>
        <Text color="gray">
          {`inference: ${llmSummary(
            config.llms.find((m) => m.default) ?? config.llms[0]!,
          )} • mcp: ${mcpServers.length} • skills: ${installedSkills.length}`}
        </Text>
      </Box>

      {body}
    </Box>
  );
}

function formatMcpServerLabel(
  transport: Stdio | StreamableHttp | Sse,
  status: McpAuthStatus | undefined,
): string {
  const summary = transportSummary(transport);
  if (
    (status === "expired" || status === "unauthenticated") &&
    summary.endsWith(" • oauth")
  ) {
    return `${summary.slice(0, -" • oauth".length)} • oauth needed`;
  }
  return summary;
}

function findMcpServerFromMenuItem(
  item: MenuItem | undefined,
  servers: Array<{ name: string; transport: Stdio | StreamableHttp | Sse }>,
): { name: string; transport: Stdio | StreamableHttp | Sse } | null {
  if (!item?.key?.startsWith("mcp-server:")) {
    return null;
  }
  const serverName = item.key.slice("mcp-server:".length);
  return servers.find((server) => server.name === serverName) ?? null;
}

function formatMcpFooterHint(
  item: MenuItem | undefined,
  servers: Array<{ name: string; transport: Stdio | StreamableHttp | Sse }>,
  statuses: Record<string, McpAuthStatus>,
): string {
  const server = findMcpServerFromMenuItem(item, servers);
  const status = server ? statuses[server.name] : undefined;
  const parts = ["enter: edit"];
  if (server && server.transport.type !== "stdio" && status !== "unsupported") {
    parts.push(status === "authenticated" ? "r: re-auth" : "r: authenticate");
    if (status === "authenticated" || status === "expired") {
      parts.push("l: logout");
    }
  }
  if (server) {
    parts.push("d: delete");
  }
  parts.push("esc: back", "ctrl+c: exit");
  return parts.join(" | ");
}
