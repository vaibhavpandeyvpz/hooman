<div align="center">
  <h1>Hooman</h1>
  <p>
    Hooman is a Bun-powered local AI agent CLI built with TypeScript, <a href="https://www.npmjs.com/package/@strands-agents/sdk">Strands Agents SDK</a>, and <a href="https://github.com/vadimdemedes/ink">Ink</a>.
  </p>
  <p>
    <a href="https://bun.com"><img src="https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun&logoColor=000000" alt="Bun" /></a>
    <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/language-TypeScript-3178C6?logo=typescript&logoColor=white" alt="TypeScript" /></a>
    <a href="https://github.com/vadimdemedes/ink"><img src="https://img.shields.io/badge/ui-Ink-6f42c1" alt="Ink" /></a>
    <a href="https://github.com/vaibhavpandeyvpz/hooman/actions/workflows/build-publish.yml"><img src="https://img.shields.io/github/actions/workflow/status/vaibhavpandeyvpz/hooman/build-publish.yml?branch=main&label=build" alt="Build" /></a>
    <a href="https://github.com/vaibhavpandeyvpz/hooman/stargazers"><img src="https://img.shields.io/github/stars/vaibhavpandeyvpz/hooman?style=flat" alt="GitHub Repo stars" /></a>
    <a href="https://github.com/vaibhavpandeyvpz/hooman/commits/main"><img src="https://img.shields.io/github/last-commit/vaibhavpandeyvpz/hooman" alt="GitHub last commit" /></a>
  </p>
  <p>
    <img src=".github/screenshot.png" alt="Hooman screenshot" />
  </p>
</div>

It gives you:

- a one-shot `exec` command for single prompts
- a stateful `chat` interface for interactive sessions
- a `daemon` command for processing MCP channel notifications in background
- an Ink-powered `configure` workflow for editing app config, `instructions.md`, MCP servers, and installed skills
- an `acp` command for running Hooman as an Agent Client Protocol (ACP) agent over stdio

## Features

- Multiple LLM providers: `ollama`, `openai`, `anthropic`, `google`, `bedrock`, `groq`, `moonshot`, `xai`
- Local configuration under `./.hooman` when that folder exists in the current working directory, otherwise `~/.hooman`
- MCP server support via `stdio`, `streamable-http`, and `sse`
- MCP server `instructions` support: server-provided instructions are appended to the agent system prompt
- MCP channel notification support through `hooman daemon --channels`
- Skill discovery / install / removal through the integrated configure flow
- Interactive terminal UI for chat and configuration

## Requirements

- [Bun](https://bun.com) `>= 1.0.0`
- Node/npm available if you want to install skills from the public skills catalog
- Provider credentials or local model runtime depending on the LLM you choose

## Usage

Fastest way to get started without cloning the repo:

```bash
npx hoomanjs configure
npx hoomanjs chat
```

Or with Bun:

```bash
bunx hoomanjs configure
bunx hoomanjs chat
```

Recommended first run:

1. Run `hooman configure` to choose your LLM provider and model.
2. Start chatting with `hooman chat`.
3. Use `hooman exec "your prompt"` for one-off tasks.

## Install

```bash
bun install
```

Run locally:

```bash
bun run src/cli.ts --help
```

Or use the dev alias:

```bash
bun run dev -- --help
```

Link the CLI locally:

```bash
bun link
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

### `hooman chat`

Start an interactive stateful chat session.

```bash
hooman chat
```

Optional initial prompt:

```bash
hooman chat "Help me plan the next task"
```

Resume or pin a session id:

```bash
hooman chat --session my-session
```

Skip the in-chat tool approval UI (same semantics as `exec --yolo`):

```bash
hooman chat --yolo
```

### `hooman daemon`

Run a long-lived daemon that subscribes to MCP servers advertising the fixed `hooman/channel` capability and feeds each received notification into the agent as a queued prompt.

```bash
hooman daemon --channels
```

Resume or pin a session id:

```bash
hooman daemon --session my-daemon --channels
```

Skip remote channel permission relay and allow every tool call from daemon turns (same risk profile as `exec` / `chat` with `--yolo`):

```bash
hooman daemon --channels --yolo
```

### Feature Flags

Runtime tools and prompt sections are controlled from `config.json` under `features`:

- `features.fetch.enabled`
- `features.filesystem.enabled`
- `features.shell.enabled`
- `features.ltm.enabled`

### `hooman configure`

Open the Ink configuration workflow.

```bash
hooman configure
```

The configure UI currently lets you:

- edit app configuration values
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

## Configuration Layout

Hooman stores its data in:

```text
./.hooman/   # when this folder exists in the current working directory
~/.hooman/   # otherwise
```

Important files and folders:

- `config.json` - app name, LLM provider/model, tool approvals, long-term memory, compaction
- `instructions.md` - system instructions used to build the agent prompt
- `mcp.json` - MCP server definitions
- `skills/` - installed skills
- `sessions/` - persisted session data
- `acp-sessions/` - persisted ACP session metadata and message snapshots

## Example `config.json`

This is the shape managed by `hooman configure`:

```json
{
  "name": "Hooman",
  "llm": {
    "provider": "ollama",
    "model": "gemma4:e4b",
    "params": {}
  },
  "tools": {
    "allowed": []
  },
  "features": {
    "fetch": {
      "enabled": true
    },
    "filesystem": {
      "enabled": true
    },
    "shell": {
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
    }
  },
  "compaction": {
    "ratio": 0.75,
    "keep": 5
  }
}
```

Supported `llm.provider` values:

- `ollama`
- `openai`
- `anthropic`
- `google`
- `bedrock`
- `groq`
- `moonshot`
- `xai`

## Provider Notes

### Ollama

Good default for local usage. Example:

```json
{
  "provider": "ollama",
  "model": "gemma4:e4b",
  "params": {}
}
```

### OpenAI

Example:

```json
{
  "provider": "openai",
  "model": "gpt-5",
  "params": {
    "apiKey": "..."
  }
}
```

### Anthropic

Provider-specific settings such as `apiKey`, `authToken`, `baseURL`, and `headers` are supported. Other values are forwarded into the model config.

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "params": {
    "apiKey": "...",
    "temperature": 0.7
  }
}
```

### Google

Uses Strands `GoogleModel` on top of `@google/genai`. Top-level options like `apiKey`, `client`, `clientConfig`, and `builtInTools` are supported; other values go into Google generation params.

```json
{
  "provider": "google",
  "model": "gemini-2.5-flash",
  "params": {
    "apiKey": "...",
    "temperature": 0.7,
    "maxOutputTokens": 2048,
    "topP": 0.9,
    "topK": 40
  }
}
```

### Bedrock

Supports `region`, `clientConfig`, and optional `apiKey`, with all other values forwarded as Bedrock model options.

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
- `hooman daemon --channels` subscribes to MCP servers that advertise the experimental `hooman/channel` capability.
- Hooman also reads `hooman/user`, `hooman/session`, and `hooman/thread` capability paths so daemon turns preserve origin metadata from the source channel.
- When a matching notification is received, Hooman uses `params.content` as the prompt if it is a string; otherwise it JSON-stringifies the notification params and sends that to the agent.
- Daemon mode processes notifications sequentially and reuses the same agent session over time.
- Tool calls from daemon turns are no longer blanket auto-approved: if the originating MCP server supports `hooman/channel/permission`, Hooman relays a remote approval request back to that source; otherwise the tool call is denied.
- `exec`, `chat`, and `daemon` accept `--yolo` to bypass those approval paths and allow all tools without prompting or relay.

## Skills

Skills are installed under:

```text
./.hooman/skills   # when ./.hooman exists
~/.hooman/skills   # otherwise
```

The configure workflow can:

- search the public skills catalog
- install a skill from a source string, repo, URL, or local path
- refresh installed skills
- remove installed skills with confirmation

## Development

Install dependencies:

```bash
bun install
```

Run the CLI:

```bash
bun run src/cli.ts --help
```

Run typecheck:

```bash
bunx tsc --noEmit
```

## License

MIT. See `LICENSE`.
