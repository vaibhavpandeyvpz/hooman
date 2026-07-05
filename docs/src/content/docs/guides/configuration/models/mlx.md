---
title: MLX
description: Configure the mlx provider — in-process Apple MLX inference via @mlx-node/lm, with MLX-format models fetched from the Hugging Face Hub.
---

Runtime provider id: `mlx`. Runs MLX-format models in-process on Apple Silicon via [@mlx-node/lm](https://github.com/mlx-node/mlx-node) (Metal GPU) — no separate server required. A fresh `config.json` ships an `mlx` provider entry with a `Qwen3 0.6B (MLX)` preset (`mlx-community/Qwen3-0.6B-bf16`) alongside the default [llama.cpp](/hooman/guides/configuration/models/llama-cpp/) presets. Weights are downloaded from the Hugging Face Hub (via `@huggingface/hub`) into `~/.hooman/cache/huggingface` on first use and reused afterwards.

:::note
Apple Silicon only. The prebuilt `@mlx-node` binaries additionally require **macOS 26 or newer** — on older macOS or non-Mac platforms the provider fails at load time with a native-module error.
:::

## Supported models

`@mlx-node/lm` implements a fixed set of architectures (detected from the repo's `config.json` `model_type`): **Qwen3**, **Qwen3.5** (dense and MoE), **Gemma 4**, and **LFM2.5**. The repo must be in MLX format — safetensors weights plus `config.json`/tokenizer files, e.g. [mlx-community](https://huggingface.co/mlx-community) conversions or [mlx-node conversions](https://github.com/mlx-node/mlx-node?tab=readme-ov-file#download-and-convert-a-model).

Quantized checkpoints must use a quantization layout mlx-node understands. Its own conversions (including Unsloth-Dynamic mixed-precision quants) load fine; mlx-community's uniform-quant repos currently do not (see the caution below) — prefer bf16 repos or mlx-node-converted quants.

## Provider options

| Field       | Type   | Notes                                                                                              |
| ----------- | ------ | -------------------------------------------------------------------------------------------------- |
| `hfToken`   | string | Optional. Hugging Face access token for gated/private repos. Falls back to the `HF_TOKEN` env var. |
| `reasoning` | object | Optional. See [Reasoning](#reasoning).                                                             |

## Model spec

The LLM entry's `options.model` accepts:

- `owner/repo` — a Hugging Face repo in MLX format (e.g. `mlx-community/Qwen3-1.7B-bf16`). All model files (config, safetensors shards, tokenizer assets) are downloaded, pinned to one revision.
- A local MLX model directory (absolute, `./relative`, or `~/`-prefixed) containing `config.json` and safetensors weights.

An optional `hf:` prefix is accepted and stripped.

## Reasoning

Providing `reasoning` enables thinking on reasoning-capable models (Qwen3/Qwen3.5): the model thinks naturally and `reasoning.effort` caps thought tokens via the runtime's thinking-token budget (`minimal`→1024, `low`→2048, `medium`→4096, `high`→8192; default `medium`). Omit `reasoning` to disable thinking — the chat template closes the think block immediately and reasoning content is dropped from the output. `summary`/`display` are not used.

## Example configs

Out-of-the-box preset (matches the default `config.json` — the llama.cpp Qwen3 1.7B entry stays the active default):

```json
{
  "name": "mlx",
  "provider": "mlx",
  "options": {}
}
```

```json
[
  {
    "name": "Qwen3 0.6B (MLX)",
    "provider": "mlx",
    "options": {
      "model": "mlx-community/Qwen3-0.6B-bf16"
    },
    "default": false
  },
  {
    "name": "Qwen3 1.7B MLX",
    "provider": "mlx",
    "options": {
      "model": "mlx-community/Qwen3-1.7B-bf16"
    },
    "default": false
  }
]
```

:::caution
mlx-community's uniform-quant repos (e.g. `Qwen3-0.6B-4bit`, `gemma-4-E2B-it-qat-4bit`) currently fail to load in `@mlx-node/lm` — its loaders expect either unquantized weights or mlx-node's own quantization layout, so 4-bit repos fail with weight-shape / missing-weight errors. Use `-bf16` repos or [convert with the mlx-node CLI](https://github.com/mlx-node/mlx-node?tab=readme-ov-file#download-and-convert-a-model) (`mlx convert -q`).
:::

Gated repo with an access token:

```json
{
  "name": "mlx gated",
  "provider": "mlx",
  "options": {
    "hfToken": "hf_..."
  }
}
```

First use of a Hub model downloads the weights, which can take a while for large repos; subsequent runs load from the cache. Downloads report live progress — percent, transferred/total size, speed, and ETA — on every surface: a progress bar above the composer in `chat`, a progress line on stderr in `exec` and `daemon`, and a download strip in the [VS Code extension](/hooman/guides/vscode/). Multi-shard safetensors report per-shard progress.

Loaded weights are shared process-wide, and each turn replays the conversation through the runtime's session API with KV-cache prefix matching, so continuing a conversation only prefills the new tokens.
