---
title: Getting Started
description: Install the full-stack Hooman agent — CLI or VS Code — local-first, BYOK, MIT licensed.
---

Hooman is the **full-stack open-source agentic ecosystem**: CLI, VS Code, ACP, daemon channels, and Design mode on one local-first runtime. Built with TypeScript, the [Strands Agents SDK](https://www.npmjs.com/package/@strands-agents/sdk), and [Ink](https://github.com/vadimdemedes/ink).

Everything — configuration, API keys, sessions, skills — lives in a single `~/.hooman` directory shared across every surface. **No account. No telemetry.** MIT licensed — BYOK, custom inference endpoints, or fully offline with llama.cpp / MLX.

## Pick your path

<div class="sl-flex" style="gap: 1rem; flex-wrap: wrap; margin-top: 1.5rem;">
  <a href="/hooman/quickstart-cli/" class="hooman-path-card">
    <strong style="font-size: 1.05rem;">Terminal / CLI →</strong>
    <p style="margin: 0.5rem 0 0; color: var(--sl-color-gray-2);"><code>curl | bash</code>, <code>npx</code>, or <code>bunx</code> — no clone, no build.</p>
  </a>
  <a href="/hooman/quickstart-vscode/" class="hooman-path-card">
    <strong style="font-size: 1.05rem;">VS Code →</strong>
    <p style="margin: 0.5rem 0 0; color: var(--sl-color-gray-2);">A native chat panel in the activity bar, from the Marketplace.</p>
  </a>
</div>

## Requirements

- [Node.js](https://nodejs.org) `>= 24` or [Bun](https://bun.sh) `>= 1.1`
- Credentials or a local runtime for whichever LLM provider you choose — see [Models](/hooman/guides/configuration/models/)

By default Hooman's first-run **setup** wizard offers local [llama.cpp](/hooman/guides/configuration/models/llama-cpp/) presets for [Gemma 4 E2B](https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF) and [Qwen3.5 2B](https://huggingface.co/unsloth/Qwen3.5-2B-MTP-GGUF) on `Q4_K_M`, plus — on Apple Silicon — local [MLX](/hooman/guides/configuration/models/mlx/) presets for [Gemma 4 E2B](https://huggingface.co/mlx-community/gemma-4-e2b-it-OptiQ-4bit) and [Qwen3.5 2B](https://huggingface.co/mlx-community/Qwen3.5-2B-OptiQ-4bit). You can finish setup with no API keys; the first local model you use downloads from the Hugging Face Hub on demand with live progress (percent, size, speed, ETA) shown in every surface. Swap in a hosted provider during setup or later via `hooman config` / Settings whenever you're ready.

## What's next

- [CLI quickstart](/hooman/quickstart-cli/) — install, first-run setup, and your first `hooman chat` session.
- [VS Code quickstart](/hooman/quickstart-vscode/) — install the extension and complete setup in the activity bar.
- [CLI reference](/hooman/guides/cli/) — `chat`, `setup`, `exec`, `daemon`, and `/config` in depth.
- [Modes](/hooman/guides/modes/) — Agent, Plan, Ask, and Design.
- [Design mode](/hooman/guides/modes/design/) — HTML artifacts, `DESIGN.md`, preview, and export to PDF, PowerPoint-ready `.pptx`, Figma-ready `.fig` / `.deck`, or Sketch-ready `.sketch`.
- [Configuration](/hooman/guides/configuration/) — `~/.hooman` layout and repo-local overlays.
- [MCP](/hooman/guides/mcp/) — tool servers, OAuth, and event-driven automation.
