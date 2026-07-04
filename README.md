<div align="center">
  <img src=".github/logo.svg" alt="Hooman logo" width="128" />
  <h1>Hooman</h1>
  <p>
    Hooman is a hackable, local-first AI agent toolkit for local workflows. It is built with TypeScript, <a href="https://www.npmjs.com/package/@strands-agents/sdk">Strands Agents SDK</a>, and <a href="https://github.com/vadimdemedes/ink">Ink</a>.
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
  <p>
    <strong><a href="https://vaibhavpandey.com/hooman/">Website</a></strong> ·
    <strong><a href="https://vaibhavpandey.com/hooman/getting-started/">Docs</a></strong> ·
    <strong><a href="https://vaibhavpandey.com/hooman/guides/vscode/">VS Code Extension</a></strong>
  </p>
</div>

Hooman reads your codebase, edits files, and runs commands — from a terminal, VS Code, or any [Agent Client Protocol](https://agentclientprotocol.com) client. Bring your own model; your config, keys, and sessions never leave `~/.hooman`.

- a one-shot `exec` command for single prompts
- a stateful `chat` interface for iterative sessions, with an in-chat `/config` workflow for models, MCP servers, and skills
- a `daemon` command for channel-driven MCP automation
- an `acp` command for running Hooman as an Agent Client Protocol agent over stdio (used by the [VS Code extension](https://vaibhavpandey.com/hooman/guides/vscode/) and editors like Zed)

## Quick start

```bash
npx hoomanjs
```

Or install globally (`npm i -g hoomanjs`), or via Bun (`bunx hoomanjs`). Then run `/config` inside the chat to pick a provider and model. Full walkthrough: [Getting Started](https://vaibhavpandey.com/hooman/getting-started/).

## Features

- Multiple LLM providers: `anthropic`, `azure`, `bedrock`, `google`, `groq`, `llama-cpp` (local GGUF, the default), `minimax`, `moonshot`, `ollama`, `openai`, `openrouter`, `xai` — see [Models](https://vaibhavpandey.com/hooman/guides/configuration/models/)
- MCP server support (`stdio`, `streamable-http`, `sse`) with OAuth (DCR + CIMD) and channel-driven automation via `hooman daemon` — see [MCP](https://vaibhavpandey.com/hooman/guides/mcp/)
- Runtime [Skills](https://vaibhavpandey.com/hooman/guides/skills/): bundled built-ins plus a local `~/.hooman/skills` catalog
- Built-in read-only subagents, a ripgrep-backed `grep` tool, and an `ask_user` tool for mid-task questions — see [Tools](https://vaibhavpandey.com/hooman/guides/tools/)
- Context-window utilization and session-cost tracking backed by [models.dev](https://models.dev), shown live in every surface
- Interactive terminal UI for chat and configuration, plus a native [VS Code chat panel](https://vaibhavpandey.com/hooman/guides/vscode/)

See the [full documentation](https://vaibhavpandey.com/hooman/) for CLI commands, configuration layout, provider setup, and more.

## Related

**Looking for a focused web UI** for chat and agent configuration with a lighter surface on top of the same stack? See [**Zero**](https://github.com/vaibhavpandeyvpz/zero) — [README](https://github.com/vaibhavpandeyvpz/zero#readme).

## Development

```bash
npm install
npm run dev -- --help    # run the CLI with tsx
npm run typecheck        # tsc --noEmit
npm run build            # tsc + copy bundled assets to dist/
```

After making any code change, run both `npm run typecheck` and `npm run build`. See [`AGENTS.md`](AGENTS.md) for the full repository layout and contributor notes, and [Development](https://vaibhavpandey.com/hooman/development/) in the docs for the release workflow.

## License

MIT. See [`LICENSE`](LICENSE).
