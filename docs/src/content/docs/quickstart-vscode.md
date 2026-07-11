---
title: VS Code
description: Install the Hooman VS Code extension — full-stack local-first agent in the activity bar.
---

`hoomanjs-vscode` adds a native **Hooman** chat panel to VS Code's activity bar, backed by [`hooman acp`](/hooman/guides/acp/). Same full-stack runtime as the CLI: modes, MCP, skills, Design mode, BYOK / custom endpoints. Works in **stable VS Code, VS Code Insiders, and compatible forks** — no proposed APIs, no special subscription. Local-first: configuration, API keys, and sessions live in `~/.hooman` on your machine.

![Hooman VS Code chat panel](/hooman/screenshots/agent-mode.png)

## Requirements

- [Node.js](https://nodejs.org) `>= 24` — `npx` ships with it and is all the extension needs to launch the agent. It downloads [`hoomanjs`](https://www.npmjs.com/package/hoomanjs) on first use.

## Install the extension

Get it from the **[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=VPZ.hoomanjs-vscode)**.

Or install it without leaving your editor — open the Command Palette (<kbd>Cmd/Ctrl+Shift+P</kbd>) and run:

```
ext install VPZ.hoomanjs-vscode
```

Or from a terminal, if the `code` CLI is on your `PATH`:

```bash
code --install-extension VPZ.hoomanjs-vscode
```

## First run

1. Click the **Hooman icon** in the activity bar. If `~/.hooman/config.json` is missing, the panel opens a **setup** wizard (same flow as the CLI):
   - pick an inference provider and enter credentials (validated against the provider)
   - pick a search provider (DuckDuckGo needs no key; others are validated with a test search)
   - write `config.json` with the available chat LLMs for that provider
2. After setup, chat opens automatically. The extension spawns `npx hoomanjs acp` for you — no separate CLI install required.
3. Explore the panel: streaming markdown and Mermaid, tool-call cards, a pinned **Changes** panel with diff/keep/undo, plan checklists, fork/copy on each turn's final reply, turn revert, and slash commands.

Setup defaults to local [llama.cpp](/hooman/guides/configuration/models/llama-cpp/) so you can start without an API key; on Apple Silicon you can choose [MLX](/hooman/guides/configuration/models/mlx/). Hosted providers are in the same wizard. Later, use **Open Settings…** (gear icon) or `hooman config` / `hooman setup` for changes. See [Configuration](/hooman/guides/configuration/) and [Models](/hooman/guides/configuration/models/).

## Next steps

- [VS Code guide](/hooman/guides/vscode/) — full feature list, commands, settings, troubleshooting, and building from source.
- [ACP](/hooman/guides/acp/) — how the extension talks to the agent.
- [CLI quickstart](/hooman/quickstart-cli/) — prefer a terminal instead?
