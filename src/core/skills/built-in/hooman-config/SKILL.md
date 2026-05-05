---
name: hooman-config
description: Read and update Hooman's own config.json and instructions.md safely. Use when the user asks about Hooman config, custom instructions, model providers, LLM params, tool toggles, prompts, search, long-term memory, wiki, agents, compaction, or ~/.hooman config settings.
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
3. `name` and `llms` are required. `llms` must be a **non-empty array** of entries (see below). `search`, `prompts`, `tools`, and `compaction` are optional in input, but Hooman expands them with defaults when loading.
4. Unknown keys are unsupported and may be dropped when Hooman parses and persists the config.
5. If changing `tools.ltm` or `tools.wiki`, preserve the existing `chroma` object unless the user asked to change it.
6. Any change to `config.json` or `instructions.md` requires restarting the running Hooman agent/session before it takes effect.

## Full Config Shape

This is the default shape Hooman writes when `~/.hooman/config.json` is missing:

```json
{
  "name": "Hooman",
  "llms": [
    {
      "name": "Default",
      "options": {
        "provider": "ollama",
        "model": "gemma4:e4b",
        "params": {}
      },
      "default": true
    }
  ],
  "search": {
    "enabled": false,
    "provider": "brave",
    "brave": {
      "apiKey": "..."
    },
    "exa": {
      "apiKey": "..."
    },
    "serper": {
      "apiKey": "..."
    },
    "tavily": {
      "apiKey": "..."
    }
  },
  "prompts": {
    "behaviour": true,
    "communication": true,
    "execution": true,
    "guardrails": true
  },
  "tools": {
    "todo": {
      "enabled": true
    },
    "fetch": {
      "enabled": true
    },
    "filesystem": {
      "enabled": true
    },
    "shell": {
      "enabled": true
    },
    "sleep": {
      "enabled": true
    },
    "ltm": {
      "enabled": false,
      "chroma": {
        "url": "http://127.0.0.1:8000",
        "collection": {
          "memory": "memory"
        }
      }
    },
    "wiki": {
      "enabled": false,
      "chroma": {
        "url": "http://127.0.0.1:8000",
        "collection": {
          "wiki": "wiki"
        }
      }
    },
    "agents": {
      "enabled": true,
      "concurrency": 2
    }
  },
  "compaction": {
    "ratio": 0.75,
    "keep": 5
  }
}
```

## Top-Level Options

- `name`: non-empty display name for the agent.
- `llms`: required non-empty list of named LLM configs (see **LLMs array**).
- `search`: optional web search config; defaults to disabled Brave.
- `prompts`: optional built-in static prompt toggles; omitted fields default to `true`. Custom user instructions live in `~/.hooman/instructions.md`.
- `tools`: optional tool toggles and tool-specific settings.
- `compaction`: optional context compaction settings. `ratio` must be `0..1`; `keep` must be a non-negative integer.

## LLMs array

Each element of `llms` has:

- `name`: non-empty label for this entry (for display and editing).
- `options`: the provider configuration (`provider`, `model`, `params`) — same semantics as the former single `llm` object.
- `default`: boolean; mark **one** entry `"default": true` for the active model. If several have `true`, the **first** in the array wins; if none have `true`, Hooman uses the **first** entry—so keep a single default when possible.

Runtime APIs may still expose a single active profile as `llm` (derived from the default entry); on disk the source of truth is always `llms`.

### LLM Providers

`options.provider` must be one of:

```json
[
  "anthropic",
  "bifrost",
  "google",
  "groq",
  "moonshot",
  "openai",
  "tensorzero",
  "ollama",
  "bedrock",
  "xai"
]
```

Common shape (single default model):

```json
{
  "llms": [
    {
      "name": "Default",
      "options": {
        "provider": "anthropic",
        "model": "claude-sonnet-4-20250514",
        "params": {
          "apiKey": "...",
          "temperature": 0.2,
          "maxTokens": 4096
        }
      },
      "default": true
    }
  ]
}
```

Provider notes (these refer to fields inside `options.params` unless noted):

- `anthropic`: Strands **AnthropicModel** (Anthropic Messages API via `@anthropic-ai/sdk`). `params.apiKey` or `params.authToken`, optional `baseURL` and `headers` (merged into `clientConfig`), optional `clientConfig`, plus model fields such as `temperature`, `maxTokens`, `topP`, `stopSequences`, and `params`. A custom `client` instance is not supported from config. If no key is set, `ANTHROPIC_API_KEY` is used.
- `google`: `params.apiKey`, `client`, `clientConfig`, and `builtInTools` are top-level Google model options. Other keys become Gemini generation params, such as `temperature`, `maxOutputTokens`, `topP`, and `topK`.
- `groq`: `params.apiKey`, `baseURL`, and `headers` configure the provider. Other keys are forwarded as Vercel model config.
- `moonshot`: `params.apiKey`, `baseURL`, `headers`, and `fetch` configure the provider. Other keys are forwarded as Vercel model config.
- `xai`: `params.apiKey`, `baseURL`, and `headers` configure the provider. Other keys are forwarded as Vercel model config.
- `openai`: Strands **OpenAIModel** (Chat Completions). `params.apiKey` (or env `OPENAI_API_KEY`), optional `clientConfig` (e.g. `baseURL` for an OpenAI-compatible HTTP API). `model` becomes `modelId`. A small client patch splits final-chunk `usage` when it arrives with non-empty `choices` so Strands can record token usage.
- `bifrost`: Same Chat Completions `params` shape as `openai`, but **`StrandsBifrostModel`** — use for a Bifrost gateway fronting Moonshot/Kimi. Set `clientConfig.baseURL` to the gateway origin (e.g. `http://localhost:8080`); `/openai/v1` is appended automatically. Handles `delta.reasoning`, missing initial `delta.role`, Moonshot `reasoning_content` on tool turns, and final-chunk usage.
- `tensorzero`: Same Chat Completions shape as `openai`, but **`StrandsTensorZeroModel`** — use for a [TensorZero](https://tensorzero.com) gateway’s OpenAI-compatible route (e.g. `clientConfig.baseURL` like `http://localhost:3000/openai/v1`). Maps gateway `tensorzero_extra_content` thoughts to Strands reasoning deltas and normalizes final-chunk usage. `model` is typically `tensorzero::function_name::<name>` (or other TensorZero model id strings the gateway accepts). For gateway tag-based rate limits, set `params.params["tensorzero::tags"]` (e.g. `user_id`) in the model entry in config.
- `ollama`: `params.host`, `keepAlive`, `options`, and `think` configure the Ollama wrapper. `think` may be `true`, `false`, `"high"`, `"medium"`, or `"low"`.
- `bedrock`: `params.region`, `clientConfig`, and optional `apiKey` configure Bedrock access. Put AWS credentials under `params.clientConfig.credentials` with `accessKeyId`, `secretAccessKey`, and optional `sessionToken`; put an AWS CLI/shared-config profile name in `params.clientConfig.profile`. If credentials and profile are omitted, Bedrock uses the AWS SDK default credential chain, including environment variables and AWS CLI/shared credentials. Other keys are forwarded as Bedrock model options, such as `temperature`, `maxTokens`, `stream`, and `cacheConfig`.

Examples:

```json
{
  "llms": [
    {
      "name": "Local",
      "options": {
        "provider": "ollama",
        "model": "qwen3:8b",
        "params": {
          "host": "http://127.0.0.1:11434",
          "think": "medium",
          "options": {
            "num_ctx": 32768,
            "temperature": 0.2
          }
        }
      },
      "default": true
    }
  ]
}
```

```json
{
  "llms": [
    {
      "name": "Gemini",
      "options": {
        "provider": "google",
        "model": "gemini-2.5-flash",
        "params": {
          "apiKey": "...",
          "temperature": 0.2,
          "maxOutputTokens": 8192
        }
      },
      "default": true
    }
  ]
}
```

```json
{
  "llms": [
    {
      "name": "Bedrock",
      "options": {
        "provider": "bedrock",
        "model": "anthropic.claude-3-5-sonnet-20241022-v2:0",
        "params": {
          "region": "us-west-2",
          "clientConfig": {
            "profile": "dev",
            "maxAttempts": 3,
            "credentials": {
              "accessKeyId": "AKIA...",
              "secretAccessKey": "...",
              "sessionToken": "..."
            }
          },
          "temperature": 0.2,
          "maxTokens": 4096
        }
      },
      "default": true
    }
  ]
}
```

For Bedrock, prefer leaving `clientConfig.credentials` out when the runtime already has AWS credentials. Without explicit credentials or `profile`, Hooman falls back to the AWS SDK default credential chain, such as `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, optional `AWS_SESSION_TOKEN`, `AWS_PROFILE`, and AWS CLI/shared credential files.

### Multiple models

You may list several entries and flip which one is default:

```json
{
  "llms": [
    {
      "name": "Fast",
      "options": {
        "provider": "openai",
        "model": "gpt-4.1-mini",
        "params": { "apiKey": "..." }
      },
      "default": true
    },
    {
      "name": "Heavy",
      "options": {
        "provider": "anthropic",
        "model": "claude-opus-4-20250514",
        "params": { "apiKey": "..." }
      },
      "default": false
    }
  ]
}
```

When editing `llms`, preserve unrelated entries and API keys unless the user asks to remove or replace them.

## Search

`search.provider` must be `"brave"`, `"exa"`, `"serper"`, or `"tavily"`.

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
    "serper": {
      "apiKey": "..."
    },
    "tavily": {
      "apiKey": "..."
    }
  }
}
```

Exa uses `POST https://api.exa.ai/search` with the API key in the `x-api-key` header ([Exa search API](https://exa.ai/docs/reference/search-api-guide-for-coding-agents)).

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
    "sleep": { "enabled": true }
  }
}
```

Long-term memory:

```json
{
  "tools": {
    "ltm": {
      "enabled": true,
      "chroma": {
        "url": "http://127.0.0.1:8000",
        "collection": {
          "memory": "memory"
        }
      }
    }
  }
}
```

Wiki:

```json
{
  "tools": {
    "wiki": {
      "enabled": true,
      "chroma": {
        "url": "http://127.0.0.1:8000",
        "collection": {
          "wiki": "wiki"
        }
      }
    }
  }
}
```

Agents:

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

Defaults: `todo`, `fetch`, `filesystem`, `shell`, `sleep`, and `agents` enabled; `ltm` and `wiki` disabled; Chroma URL `http://127.0.0.1:8000`; memory collection `memory`; wiki collection `wiki`. MCP server definitions and installed skill files are not controlled by config tool toggles; do not inspect or edit them for this skill. A missing config file is created with `agents.concurrency: 2`; if `tools.agents.concurrency` is omitted while merging partial tool config, Hooman uses `3`.

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
  "llms": [
    {
      "name": "Default",
      "options": {
        "provider": "ollama",
        "model": "gemma4:e4b",
        "params": {}
      },
      "default": true
    }
  ]
}
```

Hooman will fill all optional sections with defaults on load and persist.
