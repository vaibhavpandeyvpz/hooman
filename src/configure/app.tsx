import React, { useCallback, useEffect, useMemo, useState } from "react";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Box, Text, useApp, useInput } from "ink";
import { LlmProvider, type ConfigData } from "../core/config.js";
import {
  McpTransportSchema,
  type Sse,
  type Stdio,
  type StreamableHttp,
} from "../core/mcp/types.js";
import type { SkillListEntry } from "../core/skills/registry.js";
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
  normalizeOptional,
  noticeColor,
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
  engineering: "Engineering",
  guardrails: "Guardrails",
};

export function ConfigureApp({
  config,
  mcpConfig,
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
      if (screen.kind !== "home") {
        setScreen({ kind: "home" });
      }
    },
    { isActive: true },
  );

  const configData = useMemo(
    () =>
      ({
        name: config.name,
        llm: config.llm,
        search: config.search,
        prompts: config.prompts,
        tools: config.tools,
        compaction: config.compaction,
      }) satisfies ConfigData,
    [config, revision],
  );

  const mcpServers = useMemo(() => mcpConfig.list(), [mcpConfig, revision]);

  const setSuccess = useCallback((text: string) => {
    setNotice({ kind: "success", text });
  }, []);

  const updateConfig = useCallback(
    (partial: Partial<ConfigData>, message: string) => {
      config.update(partial);
      refresh();
      setSuccess(message);
    },
    [config, refresh, setSuccess],
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
              const transport = McpTransportSchema.parse({
                type,
                url,
                ...(headers && Object.keys(headers).length > 0
                  ? { headers }
                  : {}),
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

  const renderHome = () => {
    const items: MenuItem[] = [
      {
        label: `Configuration • ${configData.llm.provider}/${configData.llm.model}`,
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
        label: `LLM provider • ${configData.llm.provider}`,
        value: () => setScreen({ kind: "config-provider" }),
      },
      {
        label: `LLM model • ${configData.llm.model}`,
        value: () =>
          promptValue({
            title: "Update model id",
            label: "Model",
            initialValue: configData.llm.model,
            onSubmit: async (value) => {
              const model = value.trim();
              if (!model) {
                throw new Error("Model is required.");
              }
              updateConfig(
                { llm: { ...config.llm, model } },
                "Updated model id.",
              );
              setPrompt(null);
            },
          }),
      },
      {
        label: `LLM params • ${truncate(
          compactJson(maskSensitiveParamsForDisplay(configData.llm.params)),
        )}`,
        value: () =>
          promptValue({
            title: "Update LLM params",
            label: "Parameters",
            initialValue: compactJson(configData.llm.params),
            placeholder: '{"temperature":0.7}',
            onSubmit: async (value) => {
              const params = parseObjectRecord(value, "LLM params");
              updateConfig(
                { llm: { ...config.llm, params } },
                "Updated LLM params.",
              );
              setPrompt(null);
            },
          }),
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
        label: `Search tool • ${configData.search.enabled ? "Enabled" : "Disabled"} • ${configData.search.provider}`,
        value: () => setScreen({ kind: "config-search" }),
      },
      {
        label: `Todo tool • ${configData.tools.todo.enabled ? "Enabled" : "Disabled"}`,
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
        label: `Fetch tool • ${configData.tools.fetch.enabled ? "Enabled" : "Disabled"}`,
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
        label: `Filesystem tool • ${configData.tools.filesystem.enabled ? "Enabled" : "Disabled"}`,
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
        label: `Shell tool • ${configData.tools.shell.enabled ? "Enabled" : "Disabled"}`,
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
        label: `Sleep tool • ${configData.tools.sleep.enabled ? "Enabled" : "Disabled"}`,
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
        label: `Long-term memory • ${configData.tools.ltm.enabled ? "Enabled" : "Disabled"} • ${configData.tools.ltm.chroma.collection.memory}`,
        value: () => setScreen({ kind: "config-ltm" }),
      },
      {
        label: `Wiki tool • ${configData.tools.wiki.enabled ? "Enabled" : "Disabled"} • ${configData.tools.wiki.chroma.collection.wiki}`,
        value: () => setScreen({ kind: "config-wiki" }),
      },
      {
        label: `MCP tools • ${configData.tools.mcp.enabled ? "Enabled" : "Disabled"}`,
        value: () => {
          updateConfig(
            {
              tools: {
                ...config.tools,
                mcp: {
                  enabled: !configData.tools.mcp.enabled,
                },
              },
            },
            `MCP tools ${configData.tools.mcp.enabled ? "disabled" : "enabled"}.`,
          );
          setScreen({ kind: "config-tools" });
        },
      },
      {
        label: `Skills prompt • ${configData.tools.skills.enabled ? "Enabled" : "Disabled"}`,
        value: () => {
          updateConfig(
            {
              tools: {
                ...config.tools,
                skills: {
                  enabled: !configData.tools.skills.enabled,
                },
              },
            },
            `Skills prompt ${configData.tools.skills.enabled ? "disabled" : "enabled"}.`,
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

  const renderProviderMenu = () => {
    const items: MenuItem[] = [
      ...Object.values(LlmProvider).map((provider) => ({
        label:
          provider === configData.llm.provider
            ? `${provider} • current`
            : provider,
        value: () => {
          updateConfig(
            { llm: { ...config.llm, provider } },
            `Updated LLM provider to "${provider}".`,
          );
          setScreen({ kind: "config" });
        },
      })),
      {
        label: "Back",
        value: () => setScreen({ kind: "config" }),
      },
    ];

    return (
      <MenuScreen
        title="Choose Provider"
        description="Pick which model provider to use for future sessions."
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
          label: `${label} • ${enabled ? "Enabled" : "Disabled"}`,
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
      ...(["brave", "tavily"] as const).map((provider) => ({
        label:
          provider === configData.search.provider
            ? `${provider} • current`
            : provider,
        value: () => {
          updateConfig(
            {
              search: {
                ...config.search,
                provider,
              },
            },
            `Updated search provider to "${provider}".`,
          );
          setScreen({ kind: "config-search" });
        },
      })),
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
    const apiKey =
      activeProvider === "brave"
        ? configData.search.brave.apiKey
        : configData.search.tavily.apiKey;
    const redacted = compactJson(
      maskSensitiveParamsForDisplay({ apiKey: apiKey ?? "" }),
    );
    const items: MenuItem[] = [
      {
        label: `Enabled • ${configData.search.enabled ? "On" : "Off"}`,
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
        label: `Provider • ${configData.search.provider}`,
        value: () => setScreen({ kind: "config-search-provider" }),
      },
      {
        label: `${activeProvider} API key • ${truncate(redacted, 44)}`,
        value: () =>
          promptValue({
            title: `Update ${activeProvider} API key`,
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
                `Updated ${activeProvider} API key.`,
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

  const renderLtmConfigMenu = () => {
    const items: MenuItem[] = [
      {
        label: `Enabled • ${configData.tools.ltm.enabled ? "On" : "Off"}`,
        value: () => {
          updateConfig(
            {
              tools: {
                ...config.tools,
                ltm: {
                  ...config.tools.ltm,
                  enabled: !configData.tools.ltm.enabled,
                },
              },
            },
            `Long-term memory ${configData.tools.ltm.enabled ? "disabled" : "enabled"}.`,
          );
          setScreen({ kind: "config-ltm" });
        },
      },
      {
        label: `Chroma URL • ${configData.tools.ltm.chroma.url}`,
        value: () =>
          promptValue({
            title: "Update LTM Chroma URL",
            label: "URL",
            initialValue: configData.tools.ltm.chroma.url,
            onSubmit: async (value) => {
              const url = value.trim();
              if (!url) {
                throw new Error("URL is required.");
              }
              updateConfig(
                {
                  tools: {
                    ...config.tools,
                    ltm: {
                      ...config.tools.ltm,
                      chroma: {
                        ...config.tools.ltm.chroma,
                        url,
                      },
                    },
                  },
                },
                "Updated LTM Chroma URL.",
              );
              setPrompt(null);
            },
          }),
      },
      {
        label: `Chroma collection • ${configData.tools.ltm.chroma.collection.memory}`,
        value: () =>
          promptValue({
            title: "Update LTM Chroma collection",
            label: "Collection name",
            initialValue: configData.tools.ltm.chroma.collection.memory,
            onSubmit: async (value) => {
              const memory = value.trim();
              if (!memory) {
                throw new Error("Collection name is required.");
              }
              updateConfig(
                {
                  tools: {
                    ...config.tools,
                    ltm: {
                      ...config.tools.ltm,
                      chroma: {
                        ...config.tools.ltm.chroma,
                        collection: { memory },
                      },
                    },
                  },
                },
                "Updated LTM Chroma collection.",
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
        title="Long-term Memory"
        description="Configure LTM memory storage and Chroma settings."
        items={items}
      />
    );
  };

  const renderWikiConfigMenu = () => {
    const items: MenuItem[] = [
      {
        label: `Enabled • ${configData.tools.wiki.enabled ? "On" : "Off"}`,
        value: () => {
          updateConfig(
            {
              tools: {
                ...config.tools,
                wiki: {
                  ...config.tools.wiki,
                  enabled: !configData.tools.wiki.enabled,
                },
              },
            },
            `Wiki tool ${configData.tools.wiki.enabled ? "disabled" : "enabled"}.`,
          );
          setScreen({ kind: "config-wiki" });
        },
      },
      {
        label: `Chroma URL • ${configData.tools.wiki.chroma.url}`,
        value: () =>
          promptValue({
            title: "Update Wiki Chroma URL",
            label: "URL",
            initialValue: configData.tools.wiki.chroma.url,
            onSubmit: async (value) => {
              const url = value.trim();
              if (!url) {
                throw new Error("URL is required.");
              }
              updateConfig(
                {
                  tools: {
                    ...config.tools,
                    wiki: {
                      ...config.tools.wiki,
                      chroma: {
                        ...config.tools.wiki.chroma,
                        url,
                      },
                    },
                  },
                },
                "Updated Wiki Chroma URL.",
              );
              setPrompt(null);
            },
          }),
      },
      {
        label: `Chroma collection • ${configData.tools.wiki.chroma.collection.wiki}`,
        value: () =>
          promptValue({
            title: "Update Wiki Chroma collection",
            label: "Collection name",
            initialValue: configData.tools.wiki.chroma.collection.wiki,
            onSubmit: async (value) => {
              const wiki = value.trim();
              if (!wiki) {
                throw new Error("Collection name is required.");
              }
              updateConfig(
                {
                  tools: {
                    ...config.tools,
                    wiki: {
                      ...config.tools.wiki,
                      chroma: {
                        ...config.tools.wiki.chroma,
                        collection: { wiki },
                      },
                    },
                  },
                },
                "Updated Wiki Chroma collection.",
              );
              setPrompt(null);
            },
          }),
      },
      {
        label: "Back",
        value: () => setScreen({ kind: "config" }),
      },
    ];

    return (
      <MenuScreen
        title="Wiki"
        description="Configure wiki tool and Chroma-backed wiki search."
        items={items}
      />
    );
  };

  const renderMcpMenu = () => {
    const serverItems: MenuItem[] = mcpServers.flatMap((server) => [
      {
        label: `Edit ${server.name} • ${transportSummary(server.transport)}`,
        boldSubstring: server.name,
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
      },
      {
        label: `Delete ${server.name}`,
        boldSubstring: server.name,
        value: () =>
          setScreen({ kind: "mcp-delete-confirm", name: server.name }),
      },
    ]);

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
        description="List and remove local skill folders under ~/.hooman/skills."
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
      case "config-provider":
        return renderProviderMenu();
      case "config-prompts":
        return renderPromptsConfigMenu();
      case "config-tools":
        return renderToolsConfigMenu();
      case "config-search":
        return renderSearchConfigMenu();
      case "config-search-provider":
        return renderSearchProviderMenu();
      case "config-ltm":
        return renderLtmConfigMenu();
      case "config-wiki":
        return renderWikiConfigMenu();
      case "mcp":
        return renderMcpMenu();
      case "mcp-delete-confirm":
        return renderMcpDeleteConfirm();
      case "skills":
        return renderSkillsMenu();
      case "skills-delete-confirm":
        return renderSkillsDeleteConfirm();
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
          {`config: ${configData.llm.provider}/${configData.llm.model} • mcp: ${mcpServers.length} • skills: ${installedSkills.length}`}
        </Text>
      </Box>

      {body}
    </Box>
  );
}
