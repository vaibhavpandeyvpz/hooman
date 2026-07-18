import { useState } from "react";
import type { ManagementConfig } from "../../global";
import { Card, CardDescription, CardHeader, CardTitle } from "../ui/card.js";
import { Input } from "../ui/input.js";
import { Label } from "../ui/label.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select.js";
import { Switch } from "../ui/switch.js";
import { runManagementAction } from "./run-action.js";

const PROMPT_TOGGLES: Array<{ key: string; label: string }> = [
  { key: "behaviour", label: "Behaviour" },
  { key: "communication", label: "Communication" },
  { key: "execution", label: "Execution" },
  { key: "guardrails", label: "Guardrails" },
];

const TOOL_TOGGLES: Array<{ key: string; label: string }> = [
  { key: "todo", label: "Todo tracking" },
  { key: "fetch", label: "Fetch (web pages)" },
  { key: "filesystem", label: "Filesystem" },
  { key: "shell", label: "Shell" },
  { key: "sleep", label: "Sleep / wait" },
  { key: "browser", label: "Browser" },
  { key: "subagents", label: "Sub-agents" },
];

const SEARCH_PROVIDERS = [
  "brave",
  "duckduckgo",
  "exa",
  "firecrawl",
  "litellm",
  "serper",
  "tavily",
] as const;

export function GeneralTab(props: {
  config: ManagementConfig;
  version: number;
  reload: () => Promise<void>;
}) {
  const { config, version, reload } = props;

  const saveName = (name: string) => {
    if (name.trim() && name !== config.name) {
      void runManagementAction(
        () => window.hooman.saveGeneral({ name: name.trim() }),
        "App name saved.",
        reload,
      );
    }
  };

  const saveCompaction = (patch: { ratio?: number; keep?: number }) => {
    void runManagementAction(
      () => window.hooman.saveGeneral({ compaction: patch }),
      "Compaction settings saved.",
      reload,
    );
  };

  return (
    <div className="space-y-4 p-4">
      <Card>
        <CardHeader>
          <div>
            <CardTitle>General</CardTitle>
            <CardDescription>App name and reasoning display.</CardDescription>
          </div>
        </CardHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="app-name">App name</Label>
            <Input
              key={`name-${version}`}
              id="app-name"
              defaultValue={config.name}
              onBlur={(e) => saveName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Reasoning display</Label>
            <Select
              value={config.reasoning ?? "collapsed"}
              onValueChange={(value) =>
                void runManagementAction(
                  () =>
                    window.hooman.saveGeneral({
                      reasoning: value as "collapsed" | "full",
                    }),
                  "Reasoning display saved.",
                  reload,
                )
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="collapsed">Collapsed</SelectItem>
                <SelectItem value="full">Full</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Compaction</CardTitle>
            <CardDescription>
              When and how much conversation history gets summarized.
            </CardDescription>
          </div>
        </CardHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="compaction-ratio">Trigger ratio (0–1)</Label>
            <Input
              key={`ratio-${version}`}
              id="compaction-ratio"
              type="number"
              min={0}
              max={1}
              step={0.05}
              defaultValue={config.compaction.ratio}
              onBlur={(e) => {
                const value = Number(e.target.value);
                if (!Number.isNaN(value)) saveCompaction({ ratio: value });
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="compaction-keep">Keep last N turns</Label>
            <Input
              key={`keep-${version}`}
              id="compaction-keep"
              type="number"
              min={0}
              step={1}
              defaultValue={config.compaction.keep}
              onBlur={(e) => {
                const value = Number(e.target.value);
                if (!Number.isNaN(value)) saveCompaction({ keep: value });
              }}
            />
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Prompts</CardTitle>
            <CardDescription>
              Toggle sections of the built-in system prompt.
            </CardDescription>
          </div>
        </CardHeader>
        <div className="space-y-2">
          {PROMPT_TOGGLES.map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between">
              <Label htmlFor={`prompt-${key}`}>{label}</Label>
              <Switch
                id={`prompt-${key}`}
                checked={
                  (config.prompts as Record<string, boolean | undefined>)[
                    key
                  ] ?? true
                }
                onCheckedChange={(checked) =>
                  void runManagementAction(
                    () => window.hooman.setPromptToggle(key, checked),
                    `${label} prompt ${checked ? "enabled" : "disabled"}.`,
                    reload,
                  )
                }
              />
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Tools</CardTitle>
            <CardDescription>Enable or disable built-in tools.</CardDescription>
          </div>
        </CardHeader>
        <div className="space-y-2">
          {TOOL_TOGGLES.map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between">
              <Label htmlFor={`tool-${key}`}>{label}</Label>
              <Switch
                id={`tool-${key}`}
                checked={config.tools[key]?.enabled ?? true}
                onCheckedChange={(checked) =>
                  void runManagementAction(
                    () => window.hooman.setToolToggle(key, checked),
                    `${label} tool ${checked ? "enabled" : "disabled"}.`,
                    reload,
                  )
                }
              />
            </div>
          ))}
        </div>
      </Card>

      <SearchCard config={config} version={version} reload={reload} />
    </div>
  );
}

function SearchCard(props: {
  config: ManagementConfig;
  version: number;
  reload: () => Promise<void>;
}) {
  const { config, version, reload } = props;
  const [provider, setProvider] = useState(
    config.search.provider ?? "duckduckgo",
  );
  const providerConfig =
    (config.search[provider] as Record<string, unknown> | undefined) ?? {};

  const saveField = (field: "apiKey" | "baseURL" | "tool", value: string) => {
    if (!value.trim()) return;
    void runManagementAction(
      () => window.hooman.saveSearch({ provider, [field]: value.trim() }),
      "Web search settings saved.",
      reload,
    );
  };

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Web search</CardTitle>
          <CardDescription>
            Provider used by the built-in web search tool.
          </CardDescription>
        </div>
      </CardHeader>
      <div className="flex items-center justify-between">
        <Label htmlFor="search-enabled">Enabled</Label>
        <Switch
          id="search-enabled"
          checked={config.search.enabled ?? false}
          onCheckedChange={(checked) =>
            void runManagementAction(
              () => window.hooman.saveSearch({ enabled: checked }),
              `Web search ${checked ? "enabled" : "disabled"}.`,
              reload,
            )
          }
        />
      </div>
      <div className="space-y-1.5">
        <Label>Provider</Label>
        <Select
          value={provider}
          onValueChange={(value) => {
            setProvider(value);
            void runManagementAction(
              () => window.hooman.saveSearch({ provider: value }),
              "Web search provider saved.",
              reload,
            );
          }}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SEARCH_PROVIDERS.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {provider !== "duckduckgo" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="search-api-key">API key</Label>
            <Input
              key={`search-key-${provider}-${version}`}
              id="search-api-key"
              type="password"
              placeholder={
                typeof providerConfig.apiKey === "string" ? "••••••••" : ""
              }
              onBlur={(e) => saveField("apiKey", e.target.value)}
            />
          </div>
          {provider === "litellm" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="search-base-url">Base URL</Label>
                <Input
                  key={`search-base-${version}`}
                  id="search-base-url"
                  defaultValue={
                    typeof providerConfig.baseURL === "string"
                      ? providerConfig.baseURL
                      : ""
                  }
                  onBlur={(e) => saveField("baseURL", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="search-tool">Tool name</Label>
                <Input
                  key={`search-tool-${version}`}
                  id="search-tool"
                  defaultValue={
                    typeof providerConfig.tool === "string"
                      ? providerConfig.tool
                      : ""
                  }
                  onBlur={(e) => saveField("tool", e.target.value)}
                />
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  );
}
