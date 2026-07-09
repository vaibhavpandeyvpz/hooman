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
2. Pick your provider and model. Out of the box, Hooman ships local [llama.cpp](/hooman/guides/configuration/models/llama-cpp/) presets for Gemma 4 E2B and Qwen3.5 2B (downloaded from the Hugging Face Hub on first use, with a live progress strip in the panel), plus Apple-Silicon-only [MLX](/hooman/guides/configuration/models/mlx/) presets for the same two models. To use a hosted provider instead:
   - click **Open Settings…** (gear icon in the panel title bar) to edit `~/.hooman/config.json` directly, or
   - run `npx hoomanjs` in a terminal and use the [`/config`](/hooman/guides/cli/#config) workflow.

   See [Configuration](/hooman/guides/configuration/) and [Models](/hooman/guides/configuration/models/) for the full schema.

3. Explore the panel: streaming markdown and Mermaid, tool-call cards, a pinned **Changes** panel with diff/keep/undo, plan checklists, fork/copy on each turn's final reply, Cursor-style revert, and slash commands.

## Next steps

- [VS Code guide](/hooman/guides/vscode/) — full feature list, commands, settings, troubleshooting, and building from source.
- [ACP](/hooman/guides/acp/) — how the extension talks to the agent.
- [CLI quickstart](/hooman/quickstart-cli/) — prefer a terminal instead?
