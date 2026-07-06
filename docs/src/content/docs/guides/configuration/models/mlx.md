---
title: MLX
description: Configure the mlx provider — in-process Apple MLX inference via mlex.js, with MLX-format models fetched from the Hugging Face Hub.
---

Runtime provider id: `mlx`. Runs MLX-format models in-process on Apple Silicon via [mlex.js](https://github.com/vaibhavpandeyvpz/mlex) (Metal GPU) — no separate server required. A fresh `config.json` ships an `mlx` provider entry with two presets — `Gemma 4 E2B (MLX)` ([mlx-community/gemma-4-e2b-it-OptiQ-4bit](https://huggingface.co/mlx-community/gemma-4-e2b-it-OptiQ-4bit)) and `Qwen3.5 2B (MLX)` ([mlx-community/Qwen3.5-2B-OptiQ-4bit](https://huggingface.co/mlx-community/Qwen3.5-2B-OptiQ-4bit)) — alongside the bundled [llama.cpp](/hooman/guides/configuration/models/llama-cpp/) presets `unsloth/gemma-4-E2B-it-GGUF:Q4_K_M` and `unsloth/Qwen3.5-2B-MTP-GGUF:Q4_K_M`. Both MLX presets are small enough for fast prefill on CPU-bound agent turns (large system prompt + tool schemas); bigger MLX checkpoints work but prefill noticeably slower. Weights are downloaded from the Hugging Face Hub (via `@huggingface/hub`) into `~/.hooman/cache/huggingface` on first use and reused afterwards.

:::note
Apple Silicon only. The prebuilt `mlex.js` binaries additionally require **macOS 26 or newer** — on older macOS or non-Mac platforms the provider fails at load time with a native-module error.
:::

## Supported models

`mlex.js` implements a fixed set of architectures, detected from the repo's `config.json` `model_type`:

| Architecture    | `model_type`                                  | Notes                                                    |
| --------------- | --------------------------------------------- | -------------------------------------------------------- |
| Qwen2 / Qwen2.5 | `qwen2`, `llama`                              | Also covers MiniCPM5 and similar vanilla-GQA checkpoints |
| Qwen3           | `qwen3`                                       | Dense                                                    |
| Qwen3.5 / 3.6   | `qwen3_5`, `qwen3_5_moe` (+ `_text` variants) | Dense and MoE, GatedDeltaNet hybrid                      |
| Gemma 4         | `gemma4`, `gemma4_text`                       | Text-only and multi-modal (vision/audio) variants        |
| Nemotron 3 (H)  | `nemotron_h`                                  | Hybrid Mamba2/attention                                  |
| DharaAR         | `dhara_ar`                                    | Canon-conv LLaMA3-style GQA                              |

Any quantization scheme MLX ships loads across all of these: dense **bf16/fp16**, **affine 2–8 bit** at any group size (mlx-community's standard `-4bit`/`-8bit` conversions), **mxfp4/mxfp8/nvfp4**, and mixed per-layer precision recipes such as **OptiQ** or **Google QAT** exports. The repo must be in MLX format — safetensors weights plus `config.json`/tokenizer files, e.g. [mlx-community](https://huggingface.co/mlx-community) conversions.

Multi-modal Gemma 4 checkpoints accept image input; images attached to the conversation are passed through the model's vision tower automatically.

## Provider options

| Field         | Type                                                     | Notes                                                                                                                                                                                      |
| ------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `hfToken`     | string                                                   | Optional. Hugging Face access token for gated/private repos. Falls back to the `HF_TOKEN` env var.                                                                                         |
| `context`     | number                                                   | Optional. Declared context window in tokens (per-LLM `options.context` overrides it). MLX allocates KV state dynamically, so this feeds the context-usage gauge rather than sizing memory. |
| `promptCache` | `{ minTokens?, maxEntries?, ttl? }` \| `false` \| `null` | Optional. Sizes and gates mlex's internal prompt-cache pool, applied once when the model loads. See below.                                                                                 |
| `reasoning`   | object                                                   | Optional. See [Reasoning](#reasoning).                                                                                                                                                     |

`promptCache` being `undefined` (the default when omitted), `null`, or `false` disables caching entirely — every turn is a fully cold generate call. An object — even `{}` — enables it, using mlex's own pool defaults (16 entries, 300s TTL, 8-token minimum) for any field left unset:

- `maxEntries` — maximum cached prefixes the pool keeps at once (LRU-evicted beyond this).
- `ttl` — seconds an unused pool entry is kept before eviction.
- `minTokens` — prompts shorter than this many tokens are never cached.

These are forwarded to `MlexModel.load`'s pool-sizing argument, so they take effect once, when the model is loaded — not per turn. Two LLM entries sharing the same underlying model directory but different `promptCache` configs each get their own loaded session rather than silently sharing whichever loaded first. The default `config.json` ships the `mlx` provider with `"promptCache": {}` (caching on, mlex defaults).

## Model spec

The LLM entry's `options.model` accepts:

- `owner/repo` — a Hugging Face repo in MLX format (e.g. `mlx-community/Qwen3.5-2B-OptiQ-4bit`). All model files (config, safetensors shards, tokenizer assets) are downloaded, pinned to one revision.
- A local MLX model directory (absolute, `./relative`, or `~/`-prefixed) containing `config.json` and safetensors weights.

An optional `hf:` prefix is accepted and stripped.

LLM entries also support `temperature`, `maxTokens`, and `context` (context window in tokens; overrides the provider-level `context` and feeds the context-usage gauge — an explicit `billing.context` still wins over both).

## Reasoning

Providing `reasoning` enables thinking on reasoning-capable models (Qwen3/3.5, Gemma 4, Nemotron): the model thinks naturally and `reasoning.effort` caps thought tokens via the runtime's reasoning-budget enforcement (`minimal`→1024, `low`→2048, `medium`→4096, `high`→8192; default `medium`) — when the budget runs out mid-thought, the runtime force-closes the reasoning span and moves on to the answer rather than truncating the reply. Omit `reasoning` to disable thinking. `summary`/`display` are not used.

## Tool calling

Tools are declared with their standard JSON Schema parameters — no schema conversion or grammar subset applies. The runtime renders the schema through the model's own chat template and parses issued calls back out of the reply natively (Hermes JSON, the XML `<function=...>` convention newer Qwen3.5/Nemotron templates use, and Gemma's native call syntax are all handled).

## Example configs

Out-of-the-box presets (matches the default `config.json`):

```json
{
  "name": "mlx",
  "provider": "mlx",
  "options": {
    "promptCache": {}
  }
}
```

```json
[
  {
    "name": "Gemma 4 E2B (MLX)",
    "provider": "mlx",
    "options": {
      "model": "mlx-community/gemma-4-e2b-it-OptiQ-4bit",
      "context": 131072
    },
    "default": false
  },
  {
    "name": "Qwen3.5 2B (MLX)",
    "provider": "mlx",
    "options": {
      "model": "mlx-community/Qwen3.5-2B-OptiQ-4bit",
      "context": 262144
    },
    "default": false
  }
]
```

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

Loaded weights are shared process-wide, and each turn replays the full conversation through the runtime's stateless generate API — when `promptCache` is set, an internal prompt-cache pool reuses KV state for whatever prefix a previous call already computed, so continuing a conversation only prefills the new tokens. Leave the provider-level `promptCache` unset (or set it to `false`/`null`) to run every turn fully cold instead.
