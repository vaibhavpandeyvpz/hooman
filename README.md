# Hoomanity

![Hoomanity screenshot](.github/screenshot.png)

[![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun&logoColor=000000)](https://bun.com)
[![TypeScript](https://img.shields.io/badge/language-TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Ink](https://img.shields.io/badge/ui-Ink-6f42c1)](https://github.com/vadimdemedes/ink)
[![Build](https://img.shields.io/github/actions/workflow/status/vaibhavpandeyvpz/hoomanity/build-publish.yml?branch=main&label=build)](https://github.com/vaibhavpandeyvpz/hoomanity/actions/workflows/build-publish.yml)
[![GitHub Repo stars](https://img.shields.io/github/stars/vaibhavpandeyvpz/hoomanity?style=flat)](https://github.com/vaibhavpandeyvpz/hoomanity/stargazers)
[![GitHub last commit](https://img.shields.io/github/last-commit/vaibhavpandeyvpz/hoomanity)](https://github.com/vaibhavpandeyvpz/hoomanity/commits/main)

Hoomanity is a Bun-powered local AI agent CLI built with TypeScript, [Strands Agents SDK](https://www.npmjs.com/package/@strands-agents/sdk), and [Ink](https://github.com/vadimdemedes/ink).

It gives you:

- a one-shot `exec` command for single prompts
- a stateful `chat` interface for interactive sessions
- an Ink-powered `configure` workflow for editing app config, `instructions.md`, MCP servers, and installed skills

## Features

- Multiple LLM providers: `ollama`, `openai`, `anthropic`, `google`, `bedrock`
- Local configuration under `~/.hoomanity`
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
npx hoomanity configure
npx hoomanity chat
```

Or with Bun:

```bash
bunx hoomanity configure
bunx hoomanity chat
```

Recommended first run:

1. Run `hoomanity configure` to choose your LLM provider and model.
2. Start chatting with `hoomanity chat`.
3. Use `hoomanity exec "your prompt"` for one-off tasks.

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
hoomanity --help
```

## Commands

### `hoomanity exec`

Run a single prompt once.

```bash
hoomanity exec "Summarize the current repository"
```

Use a specific session id:

```bash
hoomanity exec "What changed?" --session my-session
```

### `hoomanity chat`

Start an interactive stateful chat session.

```bash
hoomanity chat
```

Optional initial prompt:

```bash
hoomanity chat "Help me plan the next task"
```

Resume or pin a session id:

```bash
hoomanity chat --session my-session
```

### `hoomanity configure`

Open the Ink configuration workflow.

```bash
hoomanity configure
```

The configure UI currently lets you:

- edit app configuration values
- edit `instructions.md` in your `$VISUAL` / `$EDITOR` (cross-platform fallback included)
- add, edit, and delete MCP servers with confirmation
- search, install, refresh, and remove skills

## Configuration Layout

Hoomanity stores its data in:

```text
~/.hoomanity/
```

Important files and folders:

- `config.json` - app name, LLM provider/model, allowed tools, long-term memory, compaction
- `instructions.md` - system instructions used to build the agent prompt
- `mcp.json` - MCP server definitions
- `skills/` - installed skills
- `sessions/` - persisted session data

## Example `config.json`

This is the shape managed by `hoomanity configure`:

```json
{
  "name": "Hoomanity",
  "llm": {
    "provider": "ollama",
    "model": "gemma4:e4b",
    "params": {}
  },
  "allowed": [],
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
~/.hoomanity/skills
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

## Notes

- The project currently uses Bun directly rather than a compiled build step.
- Full-repo `tsc` may include unrelated errors from the `reference/` tree depending on local checkout state.
