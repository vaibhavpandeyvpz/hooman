---
name: hooman-config
description: Read and update Hooman's own ~/.hooman/config.json and instructions.md. Use when the user asks about Hooman's config, custom instructions, agent name, model providers, LLMs/models, API keys, reasoning options, global reasoning display, web search settings, tool or prompt toggles, compaction, `hooman daemon` session/mcproxy limits, or first-run setup (`hooman setup`). Not for MCP servers (use hooman-mcp), channel integrations (hooman-channels), or installed skills (hooman-skills).
---

# Hooman Config

Use this skill when the user asks you to inspect, explain, or change Hooman's own `config.json` or `instructions.md`.

## Source Of Truth

- Hooman stores user data under `~/.hooman`.
- Main config: `~/.hooman/config.json`.
- User instructions: `~/.hooman/instructions.md`.
- This skill does not cover `mcp.json`, installed skill directories, or bundled skill files.

## Reference Files

Read these files (next to this SKILL.md) only when the task needs the details they cover:

- `providers.md` — full `providers`/`llms` shapes, all supported provider ids, per-provider option and `reasoning` details, and worked examples. Read it before adding or changing any provider or LLM entry.
- `search.md` — the `search` section shape, supported search providers, and per-provider notes. Read it before enabling or changing web search.

## Effective Runtime View

When `~/.hooman/config.json` is missing, the CLI (`hooman` / `hooman setup`) and
the VS Code chat panel run a first-run **setup** wizard: pick inference + search,
validate credentials, then write `config.json` with that provider's chat LLMs.
Do not invent a dual llama.cpp+MLX file as "what setup wrote" — setup writes
only the chosen provider (and the chosen search block).

Use `hooman config` to open the interactive configuration UI (same as chat
`/config`). Pass `hooman config --debug` (or `-d`) to dump the merged runtime
`config.json` for the current working directory (home config plus repo-local
`.hooman/config.json` overlays walked from git root to the current directory)
with credential-like values redacted.

## Read/Write Rules

1. Read the existing JSON first. Preserve user values, comments are not supported, and secrets such as API keys may be present.
2. Make the smallest JSON edit that satisfies the request. Do not rewrite unrelated sections or normalize formatting beyond valid pretty JSON.
3. `name`, `providers`, and `llms` are required. `providers` stores shared credentials/config, and `llms` must be a **non-empty array** of entries that reference provider names (see `providers.md`). `search`, `prompts`, `tools`, `compaction`, `daemon`, and top-level `reasoning` are optional in input, but Hooman expands them with defaults when loading.
4. Unknown keys are unsupported and may be dropped when Hooman parses and persists the config.
5. `tools` only manages built-in runtime toggles exposed in `config.json`.
6. Any change to `config.json` or `instructions.md` requires restarting the running Hooman agent/session before it takes effect. Running `hooman config` or chat `/config` applies this automatically when you return to an interactive session: chat reloads config and re-bootstraps on exit.
7. When editing `providers` or `llms`, preserve unrelated entries and API keys unless the user asks to remove or replace them.

## Full Config Shape

Example of what **first-run setup** writes when the user picks llama.cpp +
DuckDuckGo (hosted providers look the same with that provider's credentials and
prefetched `llms`; MLX is the same shape with `provider: "mlx"` and MLX model
ids). Preferred model is `default: true`; other listed chat LLMs follow:

```json
{
  "name": "Hooman",
  "providers": [
    {
      "name": "llama.cpp",
      "provider": "llama-cpp",
      "options": {}
    }
  ],
  "llms": [
    {
      "name": "Gemma 4 E2B (llama.cpp)",
      "provider": "llama.cpp",
      "options": {
        "model": "unsloth/gemma-4-E2B-it-GGUF:Q4_K_M",
        "context": 131072
      },
      "metadata": { "name": "unsloth/gemma-4-E2B-it-GGUF:Q4_K_M" },
      "default": true
    },
    {
      "name": "Qwen3.5 2B (llama.cpp)",
      "provider": "llama.cpp",
      "options": {
        "model": "unsloth/Qwen3.5-2B-MTP-GGUF:Q4_K_M",
        "context": 262144
      },
      "metadata": { "name": "unsloth/Qwen3.5-2B-MTP-GGUF:Q4_K_M" },
      "default": false
    }
  ],
  "search": {
    "enabled": true,
    "provider": "duckduckgo",
    "brave": {},
    "duckduckgo": {},
    "exa": {},
    "firecrawl": {},
    "litellm": {},
    "serper": {},
    "tavily": {}
  },
  "prompts": {
    "behaviour": true,
    "communication": true,
    "execution": true,
    "guardrails": true
  },
  "tools": {
    "todo": { "enabled": true },
    "fetch": { "enabled": true },
    "filesystem": { "enabled": true },
    "shell": { "enabled": true },
    "sleep": { "enabled": true },
    "browser": { "enabled": true },
    "subagents": { "enabled": true }
  },
  "compaction": {
    "ratio": 0.75,
    "keep": 5
  },
  "reasoning": "collapsed",
  "daemon": {
    "sessions": {
      "max": 10,
      "timeout": 300000
    },
    "mcproxy": {}
  }
}
```

If config is loaded or scaffolded without going through setup (e.g. Open
Settings before the wizard), the in-memory default still includes **both**
llama.cpp and MLX provider/LLM presets, with `tools.browser.enabled` defaulting
to `false`. Prefer reading the user's actual file over assuming either shape.

Hooman fills all optional sections with defaults on load and persist, so a minimal valid config is just `name`, `providers`, and `llms`.

## Top-Level Options

- `name`: non-empty display name for the agent.
- `providers`: required reusable provider definitions. Each entry has `name`, runtime `provider`, and provider-specific `options`. Supported runtime providers: `anthropic`, `azure`, `bedrock`, `google`, `groq`, `llama-cpp`, `minimax`, `mlx`, `moonshot`, `ollama`, `openai`, `openrouter`, `xai` — details in `providers.md`.
- `llms`: required non-empty list of named LLM configs. Each entry has `name`, provider reference `provider`, model `options` (`model`, optional `temperature`, optional `topP`, optional `maxTokens`, optional `context` — local llama-cpp/mlx providers only), optional `metadata`, and `default` (mark exactly one entry `true`). Details in `providers.md`.
- `search`: optional web search config; defaults to enabled DuckDuckGo (no API key). Details in `search.md`.
- `prompts`: optional built-in static prompt toggles; omitted fields default to `true`. Custom user instructions live in `~/.hooman/instructions.md`.
- `tools`: optional tool toggles and tool-specific settings.
- `compaction`: optional context compaction settings. `ratio` must be `0..1`; `keep` must be a non-negative integer.
- `daemon`: optional `hooman daemon` settings — `sessions.max` (default `10`, positive integer bound on concurrently active ACP sessions), `sessions.timeout` (default `300000` ms idle-close delay before an inactive ACP session closes; `0` disables ordinary idle close), and `mcproxy.port` (fixed port for the daemon's local MCP tool proxy; omitted/absent means an ephemeral port).
- top-level `reasoning`: optional global reasoning display setting. Supported values are `"collapsed"` and `"full"`.

## Prompts

Each prompt toggle (`behaviour`, `communication`, `execution`, `guardrails`) is optional and defaults to `true`. Set one to `false` only when the user explicitly wants to omit that harness section. Coding and software-engineering guidance is not a config toggle; it lives in the built-in **hooman-coding** skill and is loaded when relevant (see the system prompt skills section).

## Tools

Simple toggles. All are enabled by default except `browser`, which defaults to `false`:

```json
{
  "tools": {
    "todo": { "enabled": true },
    "fetch": { "enabled": true },
    "filesystem": { "enabled": true },
    "shell": { "enabled": true },
    "sleep": { "enabled": true },
    "browser": { "enabled": false },
    "subagents": { "enabled": true }
  }
}
```

MCP servers and installed skills are not controlled by these toggles; do not inspect or edit them for this skill.

## Instructions

`~/.hooman/instructions.md` contains the user's custom instructions. Read or edit it only when the user asks about Hooman instructions, custom instructions, persistent guidance, or agent behavior that belongs outside `config.json`. Keep instruction edits focused and preserve existing wording unless the user asks for a rewrite.

## Global reasoning display

```json
{
  "reasoning": "collapsed"
}
```

- `collapsed`: default; show reasoning in collapsed form when available.
- `full`: show the full reasoning stream inline when available.

This top-level setting controls **display in the UI**. It is separate from provider-level `options.reasoning`, which controls **whether/how a model thinks**.

## Compaction

```json
{
  "compaction": {
    "ratio": 0.75,
    "keep": 5
  }
}
```

- `ratio`: target fraction of context after compaction, from `0` to `1`.
- `keep`: minimum number of recent turns/message groups to preserve verbatim.

## Daemon

```json
{
  "daemon": {
    "sessions": {
      "max": 10,
      "timeout": 300000
    },
    "mcproxy": {
      "port": 4711
    }
  }
}
```

Settings for `hooman daemon`, which multiplexes MCP channel notifications across many ACP sessions over one supervised agent process:

- `sessions.max`: positive integer bound on concurrently active ACP sessions. Defaults to `10`. Idle sessions are evicted least-recently-used first when a new conversation needs a slot and the limit is reached.
- `sessions.timeout`: milliseconds an inactive ACP session stays open before closing. Defaults to `300000` (5 minutes). `0` disables ordinary idle close (pool-pressure eviction still applies when the daemon is at its session limit).
- `mcproxy.port`: fixed port for the daemon's local, loopback-only MCP tool proxy. Omit (or leave the object empty) for an ephemeral port, which is the default.

`--session-idle <seconds>`, `--max-active-sessions <count>`, and `--mcp-proxy-port <port>` on `hooman daemon` override these per run without editing `config.json`.
