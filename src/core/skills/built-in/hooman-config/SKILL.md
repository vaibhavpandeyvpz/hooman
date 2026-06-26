---
name: hooman-config
description: Read and update Hooman's own config.json and instructions.md safely. Use when the user asks about Hooman config, custom instructions, model providers, LLM params, tool toggles, prompts, search, agents, compaction, or ~/.hooman config settings.
---

# Hooman Config

Use this skill when the user asks you to inspect, explain, or change Hooman's own `config.json` or `instructions.md`.

## Source Of Truth

- Hooman stores user data under `~/.hooman`.
- Main config: `~/.hooman/config.json`.
- User instructions: `~/.hooman/instructions.md`.
- This skill does not cover `mcp.json`, installed skill directories, or bundled skill files.

## Read/Write Rules

1. Read the existing JSON first. Preserve user values, comments are not supported, and secrets such as API keys may be present.
2. Make the smallest JSON edit that satisfies the request. Do not rewrite unrelated sections or normalize formatting beyond valid pretty JSON.
3. `name`, `providers`, and `llms` are required. `providers` stores shared credentials/config, and `llms` must be a **non-empty array** of entries that reference provider names (see below). `search`, `prompts`, `tools`, and `compaction` are optional in input, but Hooman expands them with defaults when loading.
4. Unknown keys are unsupported and may be dropped when Hooman parses and persists the config.
5. `tools` only manages built-in runtime toggles exposed in `config.json`.
6. Any change to `config.json` or `instructions.md` requires restarting the running Hooman agent/session before it takes effect. In an interactive `chat` session, running the `/config` command applies this automatically: it reloads config and re-bootstraps the session on exit.

## Full Config Shape

This is the default shape Hooman writes when `~/.hooman/config.json` is missing:

```json
{
  "name": "Hooman",
  "providers": [
    {
      "name": "Ollama",
      "provider": "ollama",
      "options": {}
    }
  ],
  "llms": [
    {
      "name": "Default",
      "provider": "Ollama",
      "options": {
        "model": "gemma4:e4b"
      },
      "default": true
    }
  ],
  "search": {
    "enabled": false,
    "provider": "brave",
    "brave": {},
    "exa": {},
    "firecrawl": {},
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
    "agents": { "enabled": true, "concurrency": 2 }
  },
  "compaction": {
    "ratio": 0.75,
    "keep": 5
  }
}
```

## Top-Level Options

- `name`: non-empty display name for the agent.
- `providers`: required reusable provider definitions. Each entry has `name`, runtime `provider`, and provider-specific `options`.
- `llms`: required non-empty list of named LLM configs. Each entry has `name`, provider reference `provider`, model `options`, and `default`.
- `search`: optional web search config; defaults to disabled Brave.
- `prompts`: optional built-in static prompt toggles; omitted fields default to `true`. Custom user instructions live in `~/.hooman/instructions.md`.
- `tools`: optional tool toggles and tool-specific settings.
- `compaction`: optional context compaction settings. `ratio` must be `0..1`; `keep` must be a non-negative integer.

## LLMs array

Each element of `llms` has:

- `name`: non-empty label for this entry.
- `provider`: provider reference name. It must match one of the entries in top-level `providers`.
- `options.model`: model id passed to the resolved runtime provider.
- `options.temperature`: optional normalized temperature override.
- `options.maxTokens`: optional normalized output token limit.
- `default`: boolean; mark one entry `"default": true` for the active model.

## Providers array

Each element of `providers` has:

- `name`: non-empty reference name used by `llms[].provider`.
- `provider`: runtime provider id such as `"openai"`, `"bedrock"`, or `"ollama"`.
- `options`: provider-specific shared settings such as API keys, base URL, headers, region, or AWS credentials.

Supported `providers[].provider` values:

```json
[
  "anthropic",
  "bedrock",
  "google",
  "groq",
  "minimax",
  "moonshot",
  "ollama",
  "openai",
  "xai"
]
```

Common shape:

```json
{
  "providers": [
    {
      "name": "Anthropic",
      "provider": "anthropic",
      "options": {
        "apiKey": "..."
      }
    }
  ],
  "llms": [
    {
      "name": "Claude Sonnet",
      "provider": "Anthropic",
      "options": {
        "model": "claude-sonnet-4-20250514",
        "temperature": 0.2,
        "maxTokens": 4096
      },
      "default": true
    }
  ]
}
```

Provider notes:

- `anthropic`: provider `options` support `apiKey`, optional `baseURL`, optional `headers`, and optional `thinking` (`"disabled"` or `"adaptive"`). LLM `options` support `model`, `temperature`, and `maxTokens`.
- `bedrock`: provider `options` support `region`, `accessKeyId`, `secretAccessKey`, `sessionToken`, and optional `apiKey`. LLM `options` support `model`, `temperature`, and `maxTokens`.
- `google`: provider `options` support `apiKey`. LLM `options` support `model`, `temperature`, and `maxTokens` (Hooman maps this to the Google SDK's `maxOutputTokens` internally).
- `groq`: provider `options` support `apiKey`, optional `baseURL`, and optional `headers`. LLM `options` support `model`, `temperature`, and `maxTokens`.
- `minimax`: provider `options` support `apiKey`, optional `headers`, and optional `thinking`. Hooman routes this through the Anthropic-compatible MiniMax endpoint automatically.
- `moonshot`: provider `options` support `apiKey`, optional `baseURL`, and optional `headers`. When omitted, Hooman defaults the base URL to `https://api.moonshot.ai/v1`.
- `ollama`: provider `options` support optional `baseURL` and optional `thinking`. LLM `options` support `model`, `temperature`, and `maxTokens`.
- `openai`: provider `options` support `apiKey`, optional `baseURL`, and optional `headers`. LLM `options` support `model`, `temperature`, and `maxTokens`.
- `xai`: provider `options` support `apiKey`, optional `baseURL`, and optional `headers`. LLM `options` support `model`, `temperature`, and `maxTokens`.

Examples:

```json
{
  "providers": [
    {
      "name": "MiniMax",
      "provider": "minimax",
      "options": {
        "apiKey": "..."
      }
    },
    {
      "name": "Kimi",
      "provider": "moonshot",
      "options": {
        "apiKey": "..."
      }
    }
  ],
  "llms": [
    {
      "name": "MiniMax M3",
      "provider": "MiniMax",
      "options": {
        "model": "MiniMax-M3"
      },
      "default": true
    },
    {
      "name": "Kimi K2.7 Code",
      "provider": "Kimi",
      "options": {
        "model": "kimi-k2.7-code"
      },
      "default": false
    }
  ]
}
```

```json
{
  "providers": [
    {
      "name": "Bedrock",
      "provider": "bedrock",
      "options": {
        "region": "us-west-2",
        "accessKeyId": "AKIA...",
        "secretAccessKey": "...",
        "sessionToken": "..."
      }
    }
  ],
  "llms": [
    {
      "name": "Claude Sonnet",
      "provider": "Bedrock",
      "options": {
        "model": "anthropic.claude-sonnet-4-20250514-v1:0",
        "temperature": 0.2,
        "maxTokens": 4096
      },
      "default": true
    }
  ]
}
```

When editing `providers` or `llms`, preserve unrelated entries and API keys unless the user asks to remove or replace them.

## Search

`search.provider` must be `"brave"`, `"exa"`, `"firecrawl"`, `"serper"`, or `"tavily"`.

```json
{
  "search": {
    "enabled": true,
    "provider": "brave",
    "brave": {
      "apiKey": "..."
    },
    "exa": {
      "apiKey": "..."
    },
    "firecrawl": {
      "apiKey": "..."
    },
    "serper": {
      "apiKey": "..."
    },
    "tavily": {
      "apiKey": "..."
    }
  }
}
```

Hooman calls Exa through the official **`exa-js`** SDK ([Exa search API](https://exa.ai/docs/reference/search-api-guide-for-coding-agents)).

Hooman calls Firecrawl through **`@mendable/firecrawl-js`** ([Firecrawl search API](https://docs.firecrawl.dev/api-reference/endpoint/search)).

Defaults: `enabled: false`, `provider: "brave"`, all provider API keys unset.

## Prompts

Each prompt toggle is optional and defaults to `true`. Coding and software-engineering guidance is not a config toggle; it lives in the built-in **hooman-coding** skill and is loaded when relevant (see the system prompt skills section).

```json
{
  "prompts": {
    "behaviour": true,
    "communication": true,
    "execution": true,
    "guardrails": true
  }
}
```

Set a prompt to `false` only when the user explicitly wants to omit that harness section.

## Tools

Simple toggles:

```json
{
  "tools": {
    "todo": { "enabled": true },
    "fetch": { "enabled": true },
    "filesystem": { "enabled": true },
    "shell": { "enabled": true },
    "sleep": { "enabled": true },
    "agents": { "enabled": true, "concurrency": 3 }
  }
}
```

Subagents:

```json
{
  "tools": {
    "agents": {
      "enabled": true,
      "concurrency": 3
    }
  }
}
```

Defaults: `todo`, `fetch`, `filesystem`, `shell`, `sleep`, and `agents` enabled. MCP servers and installed skills are not controlled by these toggles; do not inspect or edit them for this skill.

`agents`: the default file Hooman writes when `config.json` was missing includes `tools.agents.concurrency: 2`. On load, if `concurrency` is absent (for example `tools` or `tools.agents` is omitted), the merged config uses `3` until you set it explicitly.

Compatibility note: the config key remains `tools.agents`, but it controls the built-in `run_subagents` tool.

## Instructions

`~/.hooman/instructions.md` contains the user's custom instructions. Read or edit it only when the user asks about Hooman instructions, custom instructions, persistent guidance, or agent behavior that belongs outside `config.json`.

Keep instruction edits focused and preserve existing wording unless the user asks for a rewrite.

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

## Minimal Valid Config

```json
{
  "name": "Hooman",
  "providers": [
    {
      "name": "Ollama",
      "provider": "ollama",
      "options": {}
    }
  ],
  "llms": [
    {
      "name": "Default",
      "provider": "Ollama",
      "options": {
        "model": "gemma4:e4b"
      },
      "default": true
    }
  ]
}
```

Hooman fills all optional sections with defaults on load and persist.
