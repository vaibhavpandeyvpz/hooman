---
name: hooman-config
description: Read and update Hooman's own ~/.hooman/config.json and instructions.md. Use when the user asks about Hooman's config, custom instructions, agent name, model providers, LLMs/models, API keys, reasoning options, web search settings, tool or prompt toggles, or compaction. Not for MCP servers (use hooman-mcp), channel integrations (hooman-channels), or installed skills (hooman-skills).
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

Use `hooman config` to inspect the merged runtime `config.json` for
the current working directory (home config plus repo-local `.hooman/config.json`
overlays walked from git root to the current directory). The command prints full
`config.json` shape and redacts credential-like values.

## Read/Write Rules

1. Read the existing JSON first. Preserve user values, comments are not supported, and secrets such as API keys may be present.
2. Make the smallest JSON edit that satisfies the request. Do not rewrite unrelated sections or normalize formatting beyond valid pretty JSON.
3. `name`, `providers`, and `llms` are required. `providers` stores shared credentials/config, and `llms` must be a **non-empty array** of entries that reference provider names (see `providers.md`). `search`, `prompts`, `tools`, and `compaction` are optional in input, but Hooman expands them with defaults when loading.
4. Unknown keys are unsupported and may be dropped when Hooman parses and persists the config.
5. `tools` only manages built-in runtime toggles exposed in `config.json`.
6. Any change to `config.json` or `instructions.md` requires restarting the running Hooman agent/session before it takes effect. In an interactive `chat` session, running the `/config` command applies this automatically: it reloads config and re-bootstraps the session on exit.
7. When editing `providers` or `llms`, preserve unrelated entries and API keys unless the user asks to remove or replace them.

## Full Config Shape

This is the default shape Hooman writes when `~/.hooman/config.json` is missing:

```json
{
  "name": "Hooman",
  "providers": [
    {
      "name": "llama.cpp",
      "provider": "llama-cpp",
      "options": {}
    },
    {
      "name": "mlx",
      "provider": "mlx",
      "options": { "promptCache": {} }
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
      "default": false
    },
    {
      "name": "Qwen3.5 2B (llama.cpp)",
      "provider": "llama.cpp",
      "options": {
        "model": "unsloth/Qwen3.5-2B-MTP-GGUF:Q4_K_M",
        "context": 262144
      },
      "default": false
    },
    {
      "name": "Gemma 4 E2B (MLX)",
      "provider": "mlx",
      "options": {
        "model": "mlx-community/gemma-4-e2b-it-OptiQ-4bit",
        "context": 131072
      },
      "default": false
    },
    {
      "name": "Qwen3.5 2B (MLX)",
      "provider": "mlx",
      "options": {
        "model": "mlx-community/Qwen3.5-2B-OptiQ-4bit",
        "context": 262144
      },
      "default": false
    }
  ],
  "search": {
    "enabled": false,
    "provider": "brave",
    "brave": {},
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
    "subagents": { "enabled": true }
  },
  "compaction": {
    "ratio": 0.75,
    "keep": 5
  }
}
```

Hooman fills all optional sections with defaults on load and persist, so a minimal valid config is just `name`, `providers`, and `llms`.

## Top-Level Options

- `name`: non-empty display name for the agent.
- `providers`: required reusable provider definitions. Each entry has `name`, runtime `provider`, and provider-specific `options`. Supported runtime providers: `anthropic`, `azure`, `bedrock`, `google`, `groq`, `llama-cpp`, `minimax`, `mlx`, `moonshot`, `ollama`, `openai`, `openrouter`, `xai` — details in `providers.md`.
- `llms`: required non-empty list of named LLM configs. Each entry has `name`, provider reference `provider`, model `options` (`model`, optional `temperature`, optional `maxTokens`, optional `context` — local llama-cpp/mlx providers only), and `default` (mark exactly one entry `true`). Details in `providers.md`.
- `search`: optional web search config; defaults to disabled Brave. Details in `search.md`.
- `prompts`: optional built-in static prompt toggles; omitted fields default to `true`. Custom user instructions live in `~/.hooman/instructions.md`.
- `tools`: optional tool toggles and tool-specific settings.
- `compaction`: optional context compaction settings. `ratio` must be `0..1`; `keep` must be a non-negative integer.

## Prompts

Each prompt toggle (`behaviour`, `communication`, `execution`, `guardrails`) is optional and defaults to `true`. Set one to `false` only when the user explicitly wants to omit that harness section. Coding and software-engineering guidance is not a config toggle; it lives in the built-in **hooman-coding** skill and is loaded when relevant (see the system prompt skills section).

## Tools

Simple toggles, all enabled by default:

```json
{
  "tools": {
    "todo": { "enabled": true },
    "fetch": { "enabled": true },
    "filesystem": { "enabled": true },
    "shell": { "enabled": true },
    "sleep": { "enabled": true },
    "subagents": { "enabled": true }
  }
}
```

MCP servers and installed skills are not controlled by these toggles; do not inspect or edit them for this skill.

## Instructions

`~/.hooman/instructions.md` contains the user's custom instructions. Read or edit it only when the user asks about Hooman instructions, custom instructions, persistent guidance, or agent behavior that belongs outside `config.json`. Keep instruction edits focused and preserve existing wording unless the user asks for a rewrite.

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
