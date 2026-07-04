---
title: VS Code
description: Install the Hooman VS Code extension and chat from the activity bar.
---

`hooman-vscode` adds a native **Hooman** chat panel to VS Code's activity bar, backed by [`hooman acp`](/hooman/guides/acp/). Works in **stable VS Code, VS Code Insiders, and compatible forks** — no proposed APIs, no special subscription. Local-first: configuration, API keys, and sessions live in `~/.hooman` on your machine.

## Requirements

- [Node.js](https://nodejs.org) `>= 24` — `npx` ships with it and is all the extension needs to launch the agent. It downloads [`hoomanjs`](https://www.npmjs.com/package/hoomanjs) on first use.

## Install the extension

Get it from the **[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=VPZ.hooman-vscode)**.

Or install it without leaving your editor — open the Command Palette (<kbd>Cmd/Ctrl+Shift+P</kbd>) and run:

```
ext install VPZ.hooman-vscode
```

Or from a terminal, if the `code` CLI is on your `PATH`:

```bash
code --install-extension VPZ.hooman-vscode
```

## First run

1. Click the **Hooman icon** in the activity bar and send a prompt. The extension spawns `npx hoomanjs acp` for you — no separate CLI install required.
2. Pick your provider and model. Out of the box, Hooman is configured for a local [Ollama](https://ollama.com) instance. To use a hosted provider instead:
   - click **Open Settings…** (gear icon in the panel title bar) to edit `~/.hooman/config.json` directly, or
   - run `npx hoomanjs` in a terminal and use the [`/config`](/hooman/guides/cli/#config) workflow.

   See [Configuration](/hooman/guides/configuration/) and [Providers & Models](/hooman/guides/providers/) for the full schema.

3. Explore the panel: streaming markdown, tool-call cards, a pinned **Changes** panel with diff/keep/undo, plan checklists, and slash commands.

## Next steps

- [VS Code guide](/hooman/guides/vscode/) — full feature list, commands, settings, troubleshooting, and building from source.
- [ACP](/hooman/guides/acp/) — how the extension talks to the agent.
- [CLI quickstart](/hooman/quickstart-cli/) — prefer a terminal instead?
