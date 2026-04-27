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
3. `name` and `llm` are required. `search`, `prompts`, `tools`, and `compaction` are optional in input, but Hooman expands them with defaults when loading.
4. Unknown keys are unsupported and may be dropped when Hooman parses and persists the config.
5. If changing `tools.ltm` or `tools.wiki`, preserve the existing `chroma` object unless the user asked to change it.
6. Any change to `config.json` or `instructions.md` requires restarting the running Hooman agent/session before it takes effect.

## Full Config Shape

This is the default shape Hooman writes when `~/.hooman/config.json` is missing:

```json
{
  "name": "Hooman",
  "llm": {
    "provider": "ollama",
    "model": "gemma4:e4b",
    "params": {}
  },
  "search": {
    "enabled": false,
    "provider": "brave",
    "brave": {
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
    "engineering": true,
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
    "mcp": {
      "enabled": false
    },
    "skills": {
      "enabled": false
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
- `llm`: required model provider config.
- `search`: optional web search config; defaults to disabled Brave.
- `prompts`: optional built-in static prompt toggles; omitted fields default to `true`. Custom user instructions live in `~/.hooman/instructions.md`.
- `tools`: optional tool toggles and tool-specific settings.
- `compaction`: optional context compaction settings. `ratio` must be `0..1`; `keep` must be a non-negative integer.

## LLM Providers

`llm.provider` must be one of:

```json
[
  "anthropic",
  "google",
  "groq",
  "moonshot",
  "openai",
  "ollama",
  "bedrock",
  "xai"
]
```

Common shape:

```json
{
  "llm": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "params": {
      "apiKey": "...",
      "temperature": 0.2,
      "maxTokens": 4096
    }
  }
}
```

Provider notes:

- `anthropic`: `params.apiKey`, `authToken`, `baseURL`, and `headers` configure the provider. Other keys are forwarded as Vercel model config, such as `temperature` and `maxTokens`.
- `google`: `params.apiKey`, `client`, `clientConfig`, and `builtInTools` are top-level Google model options. Other keys become Gemini generation params, such as `temperature`, `maxOutputTokens`, `topP`, and `topK`.
- `groq`: `params.apiKey`, `baseURL`, and `headers` configure the provider. Other keys are forwarded as Vercel model config.
- `moonshot`: `params.apiKey`, `baseURL`, `headers`, and `fetch` configure the provider. Other keys are forwarded as Vercel model config.
- `xai`: `params.apiKey`, `baseURL`, and `headers` configure the provider. Other keys are forwarded as Vercel model config.
- `openai`: `params.apiKey` is passed to the OpenAI model wrapper; `model` becomes `modelId`.
- `ollama`: `params.host`, `keepAlive`, `options`, and `think` configure the Ollama wrapper. `think` may be `true`, `false`, `"high"`, `"medium"`, or `"low"`.
- `bedrock`: `params.region`, `clientConfig`, and optional `apiKey` configure Bedrock access. Put AWS credentials under `params.clientConfig.credentials` with `accessKeyId`, `secretAccessKey`, and optional `sessionToken`; put an AWS CLI/shared-config profile name in `params.clientConfig.profile`. If credentials and profile are omitted, Bedrock uses the AWS SDK default credential chain, including environment variables and AWS CLI/shared credentials. Other keys are forwarded as Bedrock model options, such as `temperature`, `maxTokens`, `stream`, and `cacheConfig`.

Examples:

```json
{
  "llm": {
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
  }
}
```

```json
{
  "llm": {
    "provider": "google",
    "model": "gemini-2.5-flash",
    "params": {
      "apiKey": "...",
      "temperature": 0.2,
      "maxOutputTokens": 8192
    }
  }
}
```

```json
{
  "llm": {
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
  }
}
```

For Bedrock, prefer leaving `clientConfig.credentials` out when the runtime already has AWS credentials. Without explicit credentials or `profile`, Hooman falls back to the AWS SDK default credential chain, such as `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, optional `AWS_SESSION_TOKEN`, `AWS_PROFILE`, and AWS CLI/shared credential files.

## Search

`search.provider` must be `"brave"` or `"tavily"`.

```json
{
  "search": {
    "enabled": true,
    "provider": "brave",
    "brave": {
      "apiKey": "..."
    },
    "tavily": {
      "apiKey": "..."
    }
  }
}
```

Defaults: `enabled: false`, `provider: "brave"`, both API keys unset.

## Prompts

Each prompt toggle is optional and defaults to `true`.

```json
{
  "prompts": {
    "behaviour": true,
    "communication": true,
    "execution": true,
    "engineering": true,
    "guardrails": true
  }
}
```

Set a prompt to `false` only when the user explicitly wants to omit that static prompt section.

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
    "mcp": { "enabled": false },
    "skills": { "enabled": false }
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

Defaults: `todo`, `fetch`, `filesystem`, `shell`, `sleep`, and `agents` enabled; `ltm`, `wiki`, `mcp`, and `skills` disabled; Chroma URL `http://127.0.0.1:8000`; memory collection `memory`; wiki collection `wiki`. `tools.mcp.enabled` and `tools.skills.enabled` are only config toggles here; do not inspect or edit MCP server definitions or installed skill files for this skill. A missing config file is created with `agents.concurrency: 2`; if `tools.agents.concurrency` is omitted from an existing config, Hooman uses `3`.

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
  "llm": {
    "provider": "ollama",
    "model": "gemma4:e4b",
    "params": {}
  }
}
```

Hooman will fill all optional sections with defaults on load and persist.
