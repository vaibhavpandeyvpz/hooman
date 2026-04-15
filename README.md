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
- an Ink-powered `configure` workflow for editing app config, `instructions.md`, MCP servers, and installed skills
- an `acp` command for running Hooman as an Agent Client Protocol (ACP) agent over stdio

## Features

- Multiple LLM providers: `ollama`, `openai`, `anthropic`, `google`, `bedrock`
- Local configuration under `~/.hooman`
- MCP server support via `stdio`, `streamable-http`, and `sse`
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

Choose a toolkit size:

```bash
hooman exec "Summarize this repo" --toolkit lite
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

Choose a toolkit size:

```bash
hooman chat --toolkit max
```

### Toolkit Levels

`exec`, `chat`, and `acp` support `-t, --toolkit <lite|full|max>`.

- `lite` - time, fetch, long-term-memory, installed skills, and configured MCP server tools
- `full` - `lite` plus filesystem, shell, and thinking tools
- `max` - `full` plus skills management tools and MCP config management tools

Prompt loading follows the same split: filesystem / shell / thinking instructions are only included from `full` upward, while skills guidance is always included.

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

Choose a toolkit size for ACP-created sessions:

```bash
hooman acp --toolkit max
```

ACP notes:

- ACP sessions are stored under `~/.hooman/acp-sessions`
- ACP loads MCP servers passed on `session/new` and `session/load`, in addition to Hooman's local `mcp.json`
- ACP `session/new` and `session/load` support `_meta.userId` and `_meta.systemPrompt`
- when `_meta.systemPrompt` is provided, it is appended to the agent system prompt with a section break

## Configuration Layout

Hooman stores its data in:

```text
~/.hooman/
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
  "ltm": {
    "enabled": false,
    "chroma": {
      "url": "http://127.0.0.1:8000",
      "collection": {
        "memory": "memory"
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

## Skills

Skills are installed under:

```text
~/.hooman/skills
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
