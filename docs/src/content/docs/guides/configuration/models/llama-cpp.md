---
title: llama.cpp
description: Configure the llama-cpp provider — in-process GGUF inference via node-llama-cpp, with models fetched from the Hugging Face Hub.
---

Runtime provider id: `llama-cpp`. Runs GGUF models in-process via [node-llama-cpp](https://node-llama-cpp.withcat.ai/) — no separate server required. This is Hooman's default out-of-the-box provider: a fresh `config.json` ships three model presets — `Qwen/Qwen3-1.7B-GGUF:Q8_0` (the default), `unsloth/Qwen3.5-0.8B-MTP-GGUF:Q8_0`, and `unsloth/gemma-4-E2B-it-GGUF:Q8_0` — so the first turn works with no API keys or local runtime setup. Weights are downloaded from the Hugging Face Hub (via `@huggingface/hub`) into `~/.hooman/cache/huggingface` on first use and reused afterwards.

## Provider options

| Field         | Type              | Notes                                                                                                        |
| ------------- | ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `hfToken`     | string            | Optional. Hugging Face access token for gated/private repos. Falls back to the `HF_TOKEN` env var.           |
| `gpu`         | string or `false` | Optional. `"auto"` (default), `"metal"`, `"cuda"`, `"vulkan"`, or `false` for CPU-only inference.            |
| `contextSize` | number            | Optional. Context size in tokens; defaults to adapting to the model's training context and available memory. |
| `reasoning`   | object            | Optional. See [Reasoning](/hooman/guides/configuration/models/#reasoning-options).                           |

## Model spec

The LLM entry's `options.model` accepts:

- `owner/repo` — a Hugging Face GGUF repo. The repo's GGUF file is auto-detected; when several quant variants exist, common quantizations are preferred (Q4_K_M first).
- `owner/repo:QUANT` — pick the variant matching a quant tag, llama.cpp style (e.g. `Qwen/Qwen3-1.7B-GGUF:Q8_0`, the default).
- `owner/repo/path/to/file.gguf` — pin an exact file. Sharded GGUFs are supported; point at the first shard and the siblings are fetched too.
- A local `.gguf` path (absolute, `./relative`, or `~/`-prefixed).

An optional `hf:` prefix is accepted and stripped.

## Reasoning

Providing `reasoning` enables thinking on reasoning-capable GGUFs: the chat template is configured to allow thought segments (Qwen3 thinking mode, Gemma 4 reasoning turns, gpt-oss/Harmony native reasoning-effort levels), and `reasoning.effort` caps thought tokens via node-llama-cpp's thought budget (`minimal`→1024, `low`→2048, `medium`→4096, `high`→8192; default `medium`). Omit `reasoning` to disable thinking — templates are told to discourage thoughts and the thought budget is forced to `0`, which also reins in models that always think (e.g. DeepSeek-R1 distills). `summary`/`display` are not used.

## Example configs

Default models from the Hub (matches the out-of-the-box `config.json` — Qwen3 is the active default, Qwen3.5 and Gemma 4 ship alongside it):

```json
{
  "name": "llama.cpp",
  "provider": "llama-cpp",
  "options": {}
}
```

```json
[
  {
    "name": "Qwen3 1.7B",
    "provider": "llama.cpp",
    "options": {
      "model": "Qwen/Qwen3-1.7B-GGUF:Q8_0"
    },
    "default": true
  },
  {
    "name": "Qwen3.5 0.8B",
    "provider": "llama.cpp",
    "options": {
      "model": "unsloth/Qwen3.5-0.8B-MTP-GGUF:Q8_0"
    },
    "default": false
  },
  {
    "name": "Gemma 4 E2B",
    "provider": "llama.cpp",
    "options": {
      "model": "unsloth/gemma-4-E2B-it-GGUF:Q8_0"
    },
    "default": false
  }
]
```

:::note
Google's official `google/gemma-4-E2B-it-qat-q4_0-gguf` GGUF currently ships a malformed metadata entry (an empty key) that llama.cpp's parser rejects (`GGML_ASSERT(!key.empty())`), crashing the process on load — use the unsloth conversion above instead.
:::

Gated repo with a pinned quant file and CPU-only inference:

```json
{
  "name": "llama.cpp CPU",
  "provider": "llama-cpp",
  "options": {
    "hfToken": "hf_...",
    "gpu": false,
    "contextSize": 8192
  }
}
```

```json
{
  "name": "Qwen3 8B Q4",
  "provider": "llama.cpp CPU",
  "options": {
    "model": "Qwen/Qwen3-8B-GGUF/Qwen3-8B-Q4_K_M.gguf",
    "temperature": 0.7
  }
}
```

First use of a Hub model downloads the weights, which can take a while for large files; subsequent runs load from the cache. Downloads report live progress — percent, transferred/total size, speed, and ETA — on every surface: a progress bar above the composer in `chat`, a progress line on stderr in `exec` and `daemon`, and a download strip in the [VS Code extension](/hooman/guides/vscode/). Sharded GGUFs report per-shard progress.
