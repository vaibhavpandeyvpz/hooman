---
title: Getting Started
description: Two ways to run Hooman — pick a terminal or your editor.
---

Hooman is a hackable, local-first AI agent toolkit for building CLI, ACP, MCP, and channel-driven workflows. It's built with TypeScript, the [Strands Agents SDK](https://www.npmjs.com/package/@strands-agents/sdk), and [Ink](https://github.com/vadimdemedes/ink).

Everything — configuration, API keys, sessions, skills — lives in a single `~/.hooman` directory shared across every surface. No account, no telemetry.

## Pick your path

<div class="sl-flex" style="gap: 1rem; flex-wrap: wrap; margin-top: 1.5rem;">
  <a href="/hooman/quickstart-cli/" style="flex: 1 1 240px; display: block; padding: 1.25rem 1.5rem; border: 1px solid var(--sl-color-hairline); border-radius: 0.75rem; text-decoration: none;">
    <strong style="font-size: 1.05rem;">Terminal / CLI →</strong>
    <p style="margin: 0.5rem 0 0; color: var(--sl-color-gray-2);"><code>npx</code> or <code>bunx</code> and you're chatting — no clone, no build.</p>
  </a>
  <a href="/hooman/quickstart-vscode/" style="flex: 1 1 240px; display: block; padding: 1.25rem 1.5rem; border: 1px solid var(--sl-color-hairline); border-radius: 0.75rem; text-decoration: none;">
    <strong style="font-size: 1.05rem;">VS Code →</strong>
    <p style="margin: 0.5rem 0 0; color: var(--sl-color-gray-2);">A native chat panel in the activity bar, from the Marketplace.</p>
  </a>
</div>

## Requirements

- [Node.js](https://nodejs.org) `>= 24` or [Bun](https://bun.sh) `>= 1.1`
- Credentials or a local runtime for whichever LLM provider you choose — see [Models](/hooman/guides/configuration/models/)

By default Hooman runs [Qwen3 1.7B](https://huggingface.co/Qwen/Qwen3-1.7B-GGUF) locally via [llama.cpp](/hooman/guides/configuration/models/llama-cpp/), with [Qwen3.5 0.8B](https://huggingface.co/unsloth/Qwen3.5-0.8B-MTP-GGUF), [Gemma 4 E2B](https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF), and — on Apple Silicon — [Qwen3 0.6B](https://huggingface.co/mlx-community/Qwen3-0.6B-bf16) via [MLX](/hooman/guides/configuration/models/mlx/) preconfigured alongside it, so it works out of the box without any API keys — models download from the Hugging Face Hub on first use, with live progress (percent, size, speed, ETA) shown in every surface. Swap in a hosted provider whenever you're ready.

## What's next

- [CLI quickstart](/hooman/quickstart-cli/) — install and run your first `hooman chat` session.
- [VS Code quickstart](/hooman/quickstart-vscode/) — install the extension and chat from the activity bar.
- [CLI reference](/hooman/guides/cli/) — `chat`, `exec`, `daemon`, and `/config` in depth.
- [Configuration](/hooman/guides/configuration/) — `~/.hooman` layout and repo-local overlays.
- [MCP](/hooman/guides/mcp/) — tool servers, OAuth, and event-driven automation.
