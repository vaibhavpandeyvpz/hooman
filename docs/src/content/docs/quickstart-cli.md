---
title: CLI
description: Install and run Hooman from the terminal with Node.js or Bun.
---

## Requirements

- [Node.js](https://nodejs.org) `>= 24`, **or**
- [Bun](https://bun.sh) `>= 1.1`

Either runtime works everywhere below — pick whichever you already have installed.

## Run without installing

The fastest way to try Hooman:

```bash
npx hoomanjs
```

Or with Bun:

```bash
bunx hoomanjs
```

Both download [`hoomanjs`](https://www.npmjs.com/package/hoomanjs) on first use and cache it for next time — no separate install step, and nothing left behind if you don't keep using it.

## Install globally

If you'll be reaching for `hooman` often, install it once and run it directly:

```bash
npm i -g hoomanjs
```

```bash
bun add -g hoomanjs
```

```bash
hooman
```

## First run

1. Start chatting with `hooman` (equivalent to `hooman chat`).
2. Run `/config` inside the chat to pick your LLM provider and model, and to manage MCP servers and skills.
3. Use `hooman exec "your prompt"` for one-off tasks once you're set up.

By default Hooman ships local [llama.cpp](/hooman/guides/configuration/models/llama-cpp/) presets for [Gemma 4 E2B](https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF) and [Qwen3.5 2B](https://huggingface.co/unsloth/Qwen3.5-2B-MTP-GGUF) on `Q4_K_M`, plus — on Apple Silicon — local [MLX](/hooman/guides/configuration/models/mlx/) presets for [Gemma 4 E2B](https://huggingface.co/mlx-community/gemma-4-e2b-it-OptiQ-4bit) and [Qwen3.5 2B](https://huggingface.co/mlx-community/Qwen3.5-2B-OptiQ-4bit). It works out of the box without any API keys, and the first local model you use downloads from the Hugging Face Hub on demand with a live progress bar (percent, size, speed, ETA) in the chat. Swap in a hosted provider whenever you're ready. See [Models](/hooman/guides/configuration/models/) for the full list and configuration shape.

## Run from source

Prefer to build from the repository instead of the published package:

```bash
git clone https://github.com/vaibhavpandeyvpz/hooman.git
cd hooman
npm install
npm run dev -- --help
```

Or build and link the CLI locally:

```bash
npm run build
npm link
hooman --help
```

## Next steps

- [CLI reference](/hooman/guides/cli/) — every command, flag, and in-chat slash command.
- [Configuration](/hooman/guides/configuration/) — `~/.hooman` layout and repo-local overlays.
- [Models](/hooman/guides/configuration/models/) — connect Anthropic, OpenAI, Google, Ollama, and more.
- [VS Code quickstart](/hooman/quickstart-vscode/) — prefer a chat panel in your editor instead?
