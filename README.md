<div align="center">
  <h1>Hooman</h1>
  <p>
    Hooman is a hackable AI agent toolkit for local workflows. It is built with TypeScript, <a href="https://www.npmjs.com/package/@strands-agents/sdk">Strands Agents SDK</a>, and <a href="https://github.com/vadimdemedes/ink">Ink</a>.
  </p>
  <p>
    <a href="https://nodejs.org"><img src="https://img.shields.io/badge/runtime-Node.js-5FA04E?logo=nodedotjs&logoColor=white" alt="Node.js" /></a>
    <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/language-TypeScript-3178C6?logo=typescript&logoColor=white" alt="TypeScript" /></a>
    <a href="https://github.com/vadimdemedes/ink"><img src="https://img.shields.io/badge/ui-Ink-6f42c1" alt="Ink" /></a>
    <a href="https://github.com/vaibhavpandeyvpz/hooman/actions/workflows/publish-npm.yml"><img src="https://img.shields.io/github/actions/workflow/status/vaibhavpandeyvpz/hooman/publish-npm.yml?branch=main&label=build" alt="Build" /></a>
    <a href="https://github.com/vaibhavpandeyvpz/hooman/stargazers"><img src="https://img.shields.io/github/stars/vaibhavpandeyvpz/hooman?style=flat" alt="GitHub Repo stars" /></a>
    <a href="https://github.com/vaibhavpandeyvpz/hooman/commits/main"><img src="https://img.shields.io/github/last-commit/vaibhavpandeyvpz/hooman" alt="GitHub last commit" /></a>
  </p>
  <p>
    <img src=".github/screenshot.png" alt="Hooman screenshot" />
  </p>
</div>

It gives you a practical toolkit to build and run agent workflows:

- a one-shot `exec` command for single prompts
- a stateful `chat` interface for iterative sessions
- a `daemon` command for channel-driven MCP automation
- an in-chat `/config` workflow (Ink-powered) for general settings, models, MCP servers, and installed skills
- an `acp` command for running Hooman as an Agent Client Protocol (ACP) agent over stdio

## Related

**Looking for a focused web UI** for chat and agent configuration with lighter surface on top of the same stack? See [**Zero**](https://github.com/vaibhavpandeyvpz/zero) — [README](https://github.com/vaibhavpandeyvpz/zero#readme).

## Features

- Multiple LLM providers: `anthropic`, `bedrock`, `google`, `groq`, `moonshot`, `ollama`, `openai`, `xai`
- Local configuration under `~/.hooman`
- Optional web search tool with provider selection (`brave`, `exa`, `firecrawl`, `serper`, or `tavily`)
- MCP server support via `stdio`, `streamable-http`, and `sse`
- MCP server `instructions` support: server-provided instructions are appended to the agent system prompt
- MCP channel notifications: `hooman daemon` subscribes to servers that advertise `hooman/channel`
- Runtime skills via Strands `AgentSkills`, loading bundled built-in skills plus local `~/.hooman/skills`
- Bundled prompt harness toggles (`behaviour`, `communication`, `execution`, `guardrails`); coding guidance ships as the built-in `hooman-coding` skill
- Built-in research sub-agent runner (`research`) with configurable concurrency
- Built-in `grep` tool backed by ripgrep (`rg`), with runtime bootstrap when `rg` is not available on PATH
- Toolkit-oriented architecture with configurable tools, prompts, and transports
- Interactive terminal UI for chat and configuration

## Requirements

- [Node.js](https://nodejs.org) `>= 24`
- npm for package installs and JavaScript tooling
- Provider credentials or local model runtime depending on the LLM you choose

## Usage

Fastest way to get started without cloning the repo:

```bash
npx hoomanjs

# or install globally
npm i -g hoomanjs
```

Or with Bun:

```bash
bunx hoomanjs
```

Recommended first run:

1. Start chatting with `hooman` (same as `hooman chat`).
2. Run `/config` in chat to choose your LLM provider and model, and to manage MCP servers and skills.
3. Use `hooman exec "your prompt"` for one-off tasks.

## Must have

For the best experience, set up both:

1. **MCP servers** for on-demand tools in `chat` / `exec` (task APIs, messaging, schedulers, etc.).
2. **MCP channels** for event-driven automation with `hooman daemon` (notifications become agent prompts).

Suggested MCP servers from this ecosystem:

- [`cronmcp`](https://github.com/vaibhavpandeyvpz/cronmcp) - lets Hooman schedule recurring prompts and automations, so routine checks and follow-ups run on time.
- [`jiraxmcp`](https://github.com/vaibhavpandeyvpz/jiraxmcp) - gives Hooman direct Jira Cloud access to search issues, update tickets, and help drive sprint workflows.
- [`slackxmcp`](https://github.com/vaibhavpandeyvpz/slackxmcp) - connects Hooman to Slack so it can read channel context, draft updates, and post actions where your team already works.
- [`tgfmcp`](https://github.com/vaibhavpandeyvpz/tgfmcp) - enables Telegram bot workflows, making it easy to route notifications and respond from agent-driven chats.
- [`wappmcp`](https://github.com/vaibhavpandeyvpz/wappmcp) - brings WhatsApp Web messaging into Hooman for customer or team communication automations.

For production deployments, still review permissions and use least-privilege credentials/tokens for each integration.

## Install

```bash
npm install
```

Run locally:

```bash
npm run dev -- --help
```

Or use the dev alias:

```bash
npm run build
node dist/cli.js --help
```

Link the CLI locally:

```bash
npm link
hooman --help
```

## Commands

### `hooman exec`

Run a single prompt once.

```bash
hooman exec "Summarize the current repository"
```

Use a specific session id:

```bash
hooman exec "What changed?" --session my-session
```

Skip interactive tool approval (allows every tool call; use only when you trust the prompt and environment):

```bash
hooman exec "Summarize this repo" --yolo
```

Start in **ask** mode (narrower tool surface, no plan lifecycle tools; see [Session mode](#session-mode)):

```bash
hooman exec "Map the architecture" --mode ask
```

### `hooman chat`

Start an interactive stateful chat session.

```bash
hooman
```

Equivalent explicit form:

```bash
hooman chat
```

Optional initial prompt:

```bash
hooman chat "Help me prioritize the next task"
```

Resume or pin a session id:

```bash
hooman chat --session my-session
```

Skip the in-chat tool approval UI (same semantics as `exec --yolo`):

```bash
hooman chat --yolo
```

Start in ask mode:

```bash
hooman chat --mode ask
```

### Chat commands

Inside an interactive `chat` session, type `/` to discover slash commands:

- `/model` - pick or set the chat model for this session.
- `/mode` - switch the session mode (`agent`, `ask`, `plan`); see [Session mode](#session-mode).
- `/yolo` - toggle auto-approve of tool calls (`on` / `off`).
- `/init` - generate or refresh `AGENTS.md` for the current project.
- `/compact` - compact the conversation history now and persist the result.
- `/new` - start a fresh chat session.
- `/config` - launch the configuration workflow (see below).

### Session mode

`exec`, `chat`, and `daemon` accept **`-m` / `--mode`** with:

- **`agent`** (default): normal tool surface and approvals.
- **`plan`**: planning workflow with a reduced tool surface plus `enter_plan_mode` / `exit_plan_mode`.
- **`ask`**: read-oriented, narrower surface (similar to interactive **plan** mode) but **without** `enter_plan_mode` / `exit_plan_mode`.

In **`chat`**, `/mode` can switch between **agent**, **ask**, and **plan**. **ACP** sessions can set `hooman.sessionMode` to `agent`, `plan`, or `ask`.

### `hooman daemon`

Run a long-lived daemon that **always** subscribes to MCP servers advertising the `hooman/channel` capability and feeds each received notification into the agent as a queued prompt.

```bash
hooman daemon
```

Resume or pin a session id:

```bash
hooman daemon --session my-daemon
```

Skip remote channel permission relay and allow every tool call from daemon turns (same risk profile as `exec` / `chat` with `--yolo`):

```bash
hooman daemon --yolo
```

Optional `--mode ask` matches `exec` / `chat` (narrow surface without plan lifecycle tools).

Log raw notification payloads:

```bash
hooman daemon --debug
```

### Feature Flags

Runtime tool and prompt switches are controlled from `config.json`:

- `search.enabled`
- `search.provider` (`brave`, `exa`, `firecrawl`, `serper`, or `tavily`)
- `search.brave.apiKey`
- `search.exa.apiKey`
- `search.firecrawl.apiKey`
- `search.serper.apiKey`
- `search.tavily.apiKey`
- `prompts.behaviour`
- `prompts.communication`
- `prompts.execution`
- `prompts.guardrails`
- `tools.todo.enabled`
- `tools.fetch.enabled`
- `tools.filesystem.enabled`
- `tools.shell.enabled`
- `tools.sleep.enabled`
- `tools.agents.enabled` (enables built-in `run_subagents` tool)
- `tools.agents.concurrency` (defaults to `3` when omitted on load; a freshly generated default `config.json` uses `2`)

### `/config`

The configuration workflow is launched from inside a `chat` session with the `/config` slash command (there is no separate top-level `configure` command). It takes over the terminal on the alternate screen buffer while open, and restores the chat session on exit. Any config changes are picked up when the session re-bootstraps.

```text
/config
```

The configuration UI currently lets you:

- manage general settings such as name, prompts, tools, and compaction
- manage models and providers
- choose search provider and set its API key
- toggle bundled harness prompts (`behaviour`, `communication`, `execution`, `guardrails`)
- edit `instructions.md` in your `$VISUAL` / `$EDITOR` (cross-platform fallback included)
- add, edit, and delete MCP servers with confirmation
- search, install, refresh, and remove skills

### `hooman acp`

Run Hooman as an Agent Client Protocol (ACP) agent over stdio.

```bash
hooman acp
```

ACP notes:

- ACP sessions are stored under the active Hooman data directory in `acp-sessions/`
- ACP loads MCP servers passed on `session/new` and `session/load`, in addition to Hooman's local `mcp.json`
- ACP `session/new` and `session/load` support `_meta.userId` and `_meta.systemPrompt`
- when `_meta.systemPrompt` is provided, it is appended to the agent system prompt with a section break
- session configuration includes `hooman.sessionMode` (`agent`, `plan`, or `ask`); see [Session mode](#session-mode)

## Configuration Layout

Hooman stores its data in:

```text
~/.hooman/
```

Important files and folders:

- `config.json` - app name, reusable provider configs, model configs, tool flags, and compaction
- `instructions.md` - system instructions used to build the agent prompt
- `mcp.json` - MCP server definitions
- `skills/` - installed skills
- `bin/` - runtime-managed helper binaries (including bootstrapped `rg` for the `grep` tool when system `rg` is unavailable)
- `cache/` - runtime caches used by tools and subsystems
- `sessions/` - persisted session data
- `acp-sessions/` - persisted ACP session metadata and message snapshots

`grep` tool binary resolution order:

1. Use system `rg` when available.
2. Else use cached `~/.hooman/bin/rg` (or `rg.exe` on Windows).
3. Else download and verify a platform-specific ripgrep release into `~/.hooman/bin/`.

## Example `config.json`

The on-disk shape uses a reusable **`providers`** array plus a non-empty **`llms`** array. Each provider stores the shared runtime type and params once; each LLM references a provider by name, sets its `model`, optional model-specific `params`, and `default`. The bundled **hooman-config** skill documents the full schema.

```json
{
  "name": "Hooman",
  "providers": [
    {
      "name": "ollama-local",
      "options": {
        "provider": "ollama",
        "params": {}
      }
    }
  ],
  "llms": [
    {
      "name": "Default",
      "options": {
        "provider": "ollama-local",
        "model": "gemma4:e4b",
        "params": {}
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

Tool approvals are session-scoped and are not persisted in `config.json`.

Hooman enables Strands `ContextOffloader` by default with file-backed storage under `~/.hooman/sessions/offloaded-content`, so large tool results can be previewed in-context and retrieved later without bloating the active conversation window.

Supported `providers[].options.provider` values registered in this release (see `src/core/models/index.ts`):

- `anthropic`
- `bedrock`
- `google`
- `groq`
- `moonshot`
- `ollama`
- `openai`
- `xai`

The `LlmProvider` enum in `src/core/config.ts` may list additional strings for forwards compatibility; unknown providers are not loaded at runtime.

Supported `search.provider` values:

- `brave`
- `exa`
- `firecrawl`
- `serper`
- `tavily`

## Provider Notes

### Ollama

Good default for local usage. Example:

```json
{
  "providers": [
    {
      "name": "ollama-local",
      "options": {
        "provider": "ollama",
        "params": {}
      }
    }
  ],
  "llms": [
    {
      "name": "Default",
      "options": {
        "provider": "ollama-local",
        "model": "gemma4:e4b",
        "params": {}
      },
      "default": true
    }
  ]
}
```

### OpenAI

Uses Strands **OpenAIModel** (Chat Completions). `apiKey` is optional if `OPENAI_API_KEY` is set. Use `clientConfig` for a custom base URL or other OpenAI client options (OpenAI-compatible proxies and gateways).

Example:

```json
{
  "providers": [
    {
      "name": "openai",
      "options": {
        "provider": "openai",
        "params": {
          "apiKey": "..."
        }
      }
    }
  ],
  "llms": [
    {
      "name": "GPT-5",
      "options": {
        "provider": "openai",
        "model": "gpt-5",
        "params": {}
      },
      "default": true
    }
  ]
}
```

OpenAI-compatible gateways that put token `usage` on the last streamed chunk together with `choices` are handled via a small stream shim so usage still surfaces in the UI.

### Anthropic

Uses Strands **AnthropicModel** (Anthropic Messages API). `apiKey` or `authToken`, optional `baseURL` and `headers` (merged into `clientConfig`), optional `clientConfig`, and model fields such as `temperature` and `maxTokens`. A prebuilt `client` is not configurable from JSON.

```json
{
  "providers": [
    {
      "name": "anthropic",
      "options": {
        "provider": "anthropic",
        "params": {
          "apiKey": "..."
        }
      }
    }
  ],
  "llms": [
    {
      "name": "Claude Sonnet",
      "options": {
        "provider": "anthropic",
        "model": "claude-sonnet-4-20250514",
        "params": {
          "temperature": 0.7
        }
      },
      "default": true
    }
  ]
}
```

### Google

Uses Strands `GoogleModel` on top of `@google/genai`. Top-level options like `apiKey`, `client`, `clientConfig`, and `builtInTools` are supported; other values go into Google generation params.

```json
{
  "providers": [
    {
      "name": "google",
      "options": {
        "provider": "google",
        "params": {
          "apiKey": "..."
        }
      }
    }
  ],
  "llms": [
    {
      "name": "Gemini Flash",
      "options": {
        "provider": "google",
        "model": "gemini-2.5-flash",
        "params": {
          "temperature": 0.7,
          "maxOutputTokens": 2048,
          "topP": 0.9,
          "topK": 40
        }
      },
      "default": true
    }
  ]
}
```

### Bedrock

Supports `region`, `clientConfig`, and optional `apiKey`, with all other values forwarded as Bedrock model options.

```json
{
  "providers": [
    {
      "name": "bedrock-dev",
      "options": {
        "provider": "bedrock",
        "params": {
          "region": "us-east-1",
          "clientConfig": {
            "profile": "dev",
            "maxAttempts": 3,
            "credentials": {
              "accessKeyId": "AKIA...",
              "secretAccessKey": "...",
              "sessionToken": "..."
            }
          }
        }
      }
    }
  ],
  "llms": [
    {
      "name": "Claude Sonnet",
      "options": {
        "provider": "bedrock-dev",
        "model": "anthropic.claude-sonnet-4-20250514-v1:0",
        "params": {
          "temperature": 0.7,
          "maxTokens": 1024
        }
      },
      "default": true
    }
  ]
}
```

You can also rely on the AWS default credential chain (recommended) by setting environment variables such as `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and optionally `AWS_SESSION_TOKEN`.

### Groq

### Anthropic

Uses Strands `AnthropicModel` on top of `@anthropic-ai/sdk`. Provider-specific settings `apiKey`/`authToken`, `baseURL`, `headers`, `clientConfig`, `betas`, and `useNativeTokenCount` are picked up directly. Standard model config such as `temperature`, `topP`, `maxTokens`, and `stopSequences` stays top-level. Any other keys are forwarded to the Anthropic Messages request body, which is useful for Anthropic-compatible providers such as MiniMax.

For MiniMax specifically:

- Use `baseURL: "https://api.minimax.io/anthropic"`.
- `MiniMax-M3` can emit visible thinking blocks when you set `thinking: { "type": "adaptive" }`.
- `MiniMax-M2.7` / `M2.5` / `M2.1` / `M2` do internal reasoning, but MiniMax’s Anthropic-compatible API does not expose those as `thinking` content blocks, so Hooman has nothing to render in the transcript.

```json
{
  "provider": "anthropic",
  "model": "MiniMax-M3",
  "params": {
    "apiKey": "...",
    "baseURL": "https://api.minimax.io/anthropic",
    "thinking": { "type": "adaptive" },
    "temperature": 1
  }
}
```

### Groq

Uses the Vercel AI SDK Groq provider (`@ai-sdk/groq`) on top of Strands `VercelModel`. Provider-specific settings `apiKey`, `baseURL`, and `headers` are picked up; other values are forwarded into the model config (`temperature`, `maxTokens`, etc.). Defaults to `GROQ_API_KEY` from the environment when no `apiKey` is supplied.

```json
{
  "provider": "groq",
  "model": "gemma2-9b-it",
  "params": {
    "apiKey": "...",
    "temperature": 0.7
  }
}
```

### Moonshot

Uses the Vercel AI SDK Moonshot provider (`@ai-sdk/moonshotai`) on top of Strands `VercelModel`. Provider-specific settings `apiKey`, `baseURL`, `headers`, and `fetch` are picked up; other values are forwarded into the model config (`temperature`, `maxTokens`, `providerOptions`, etc.). Defaults to `MOONSHOT_API_KEY` from the environment when no `apiKey` is supplied. Moonshot reasoning models such as `kimi-k2-thinking` can be configured through `params.providerOptions.moonshotai`.

```json
{
  "provider": "moonshot",
  "model": "kimi-k2.5",
  "params": {
    "apiKey": "...",
    "temperature": 0.7
  }
}
```

### xAI

Uses the Vercel AI SDK xAI provider (`@ai-sdk/xai`) on top of Strands `VercelModel`. Provider-specific settings `apiKey`, `baseURL`, and `headers` are picked up; other values are forwarded into the model config (`temperature`, `maxTokens`, etc.). Defaults to `XAI_API_KEY` from the environment when no `apiKey` is supplied.

```json
{
  "provider": "xai",
  "model": "grok-4.20-non-reasoning",
  "params": {
    "apiKey": "...",
    "temperature": 0.7
  }
}
```

## MCP Configuration

Detailed design notes for planned OAuth-enabled remote MCP support live in [docs/mcp-oauth-design.md](docs/mcp-oauth-design.md).

`mcp.json` is stored as:

```json
{
  "mcpServers": {}
}
```

### Example stdio server

```json
{
  "mcpServers": {
    "filesystem": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      "env": {
        "EXAMPLE": "1"
      },
      "cwd": "/tmp"
    }
  }
}
```

### Example streamable HTTP server

```json
{
  "mcpServers": {
    "remote": {
      "type": "streamable-http",
      "url": "https://example.com/mcp",
      "headers": {
        "Authorization": "Bearer token"
      }
    }
  }
}
```

### Example OAuth-capable remote server

```json
{
  "mcpServers": {
    "linear": {
      "type": "streamable-http",
      "url": "https://example.com/mcp",
      "oauth": {
        "enabled": true,
        "clientId": "optional-pre-registered-client",
        "scopes": ["read", "write"],
        "callbackPort": 19876
      }
    }
  }
}
```

### Example SSE server

```json
{
  "mcpServers": {
    "legacy": {
      "type": "sse",
      "url": "https://example.com/sse",
      "headers": {
        "Authorization": "Bearer token"
      }
    }
  }
}
```

## MCP Notes

- MCP server `instructions` from the protocol `initialize` response are appended to Hooman's system prompt, after local `instructions.md` and session-specific prompt overrides.
- Hooman reads these instructions automatically from connected MCP servers when building the agent.
- Remote MCP OAuth helpers are available via:
  - `hooman mcp auth <server>`
  - `hooman mcp logout <server>`
  - `hooman mcp auth-status`
- `hooman daemon` subscribes to MCP servers that advertise the experimental `hooman/channel` capability (always on; there is no opt-out flag).
- Hooman also reads `hooman/user`, `hooman/session`, and `hooman/thread` capability paths so daemon turns preserve origin metadata from the source channel.
- When a matching notification is received, Hooman uses `params.content` as the prompt if it is a string; otherwise it JSON-stringifies the notification params and sends that to the agent.
- Daemon mode processes notifications sequentially and reuses the same agent session over time.
- Tool calls from daemon turns are no longer blanket auto-approved: if the originating MCP server supports `hooman/channel/permission`, Hooman relays a remote approval request back to that source; otherwise the tool call is denied.
- `exec`, `chat`, and `daemon` accept `--yolo` to bypass those approval paths and allow all tools without prompting or relay.

## Skills

Skills are installed under:

```text
~/.hooman/skills
```

At runtime, Hooman uses the Strands `AgentSkills` plugin to load:

- bundled built-in skills shipped with Hooman
- user-installed skills under `~/.hooman/skills`

The local skills folder is treated as a parent directory of skill subdirectories, where each installed skill should live in its own folder containing `SKILL.md`.

When a session starts, the plugin injects available skill metadata into the system prompt and exposes the `skills` tool so the model can activate a skill and load its full instructions on demand.

The `/config` workflow can:

- search the public skills catalog
- install a skill from a source string, repo, URL, or local path
- refresh installed skills
- remove installed skills with confirmation

## Development

Install dependencies:

```bash
npm install
```

Run the CLI:

```bash
npm run dev -- --help
```

Run typecheck:

```bash
npm run typecheck
```

## License

MIT. See `LICENSE`.
