---
title: Models
description: BYOK providers, local llama.cpp & MLX, and custom inference endpoints — shared config shape for the full stack.
---

Hooman is **bring-your-own-model** by design: local llama.cpp / MLX with no API keys, hosted providers with your keys, or OpenAI-compatible `baseUrl`s pointed at private gateways and vLLM clusters. First-run [setup](/hooman/guides/cli/#hooman-setup) (CLI and VS Code) validates one provider and writes its available chat LLMs into `config.json`. That file splits model configuration into reusable `providers` (credentials and provider-level options) and `llms` (named model presets that reference a provider by name). Each provider page below covers its `options` fields, reasoning support, and example configs.

## Supported providers

| Provider                                                      | Runtime id   |
| ------------------------------------------------------------- | ------------ |
| [Anthropic](/hooman/guides/configuration/models/anthropic/)   | `anthropic`  |
| [Azure](/hooman/guides/configuration/models/azure/)           | `azure`      |
| [Bedrock](/hooman/guides/configuration/models/bedrock/)       | `bedrock`    |
| [Google](/hooman/guides/configuration/models/google/)         | `google`     |
| [Groq](/hooman/guides/configuration/models/groq/)             | `groq`       |
| [llama.cpp](/hooman/guides/configuration/models/llama-cpp/)   | `llama-cpp`  |
| [MiniMax](/hooman/guides/configuration/models/minimax/)       | `minimax`    |
| [MLX](/hooman/guides/configuration/models/mlx/)               | `mlx`        |
| [Moonshot](/hooman/guides/configuration/models/moonshot/)     | `moonshot`   |
| [Ollama](/hooman/guides/configuration/models/ollama/)         | `ollama`     |
| [OpenAI](/hooman/guides/configuration/models/openai/)         | `openai`     |
| [OpenRouter](/hooman/guides/configuration/models/openrouter/) | `openrouter` |
| [xAI](/hooman/guides/configuration/models/xai/)               | `xai`        |

## Shared shape

```json
{
  "name": "MiniMax",
  "provider": "minimax",
  "options": {
    "apiKey": "..."
  }
}
```

```json
{
  "name": "MiniMax M3",
  "provider": "MiniMax",
  "options": {
    "model": "MiniMax-M3",
    "temperature": 1,
    "maxTokens": 4096
  },
  "default": true
}
```

Every `llms` entry, regardless of provider, carries the same normalized `options` shape: `model` (required), optional `temperature`, optional `topP`, optional `maxTokens` (Google maps this to the SDK's `maxOutputTokens`), and optional `context` (context size in tokens — only honored by the local [llama.cpp](/hooman/guides/configuration/models/llama-cpp/) and [MLX](/hooman/guides/configuration/models/mlx/) providers, where it overrides the provider-level `context` and feeds the context-usage gauge; other providers ignore it).

All reasoning-capable providers additionally share a common optional `reasoning` object on the **provider** `options`: `{ effort?, summary?, display? }`. `effort` (`"minimal" | "low" | "medium" | "high"`) enables thinking; `summary` (OpenAI/Azure Responses API only) controls summary verbosity; `display` (Bedrock Claude / MiniMax only) controls whether the reasoning trace is returned. Each provider page documents its exact mapping.

## Reasoning options

Provider-level `options.reasoning` uses the same normalized shape everywhere, even though each backend maps it differently:

| Field     | Type          | Used by    |
| --------- | ------------- | ---------- |
| `effort`  | `"minimal"    | "low"      | "medium"                         | "high"` | All reasoning-capable providers; enables thinking when present. |
| `summary` | `"auto"       | "concise"  | "detailed"                       | "none"` | OpenAI / Azure Responses API only.                              |
| `display` | `"summarized" | "omitted"` | Bedrock Claude and MiniMax only. |

Notes:

- `reasoning` belongs on the **provider** entry, not the per-LLM `options` block.
- top-level [`reasoning` in `config.json`](/hooman/guides/configuration/#global-reasoning-display) is separate: it controls how reasoning is displayed in the UI, not whether the model reasons.
- Providers that do not support a given field simply ignore it or reject it as documented on their provider page.

## LLM metadata

Each LLM entry may carry an optional `metadata` block used to display context-window utilization and cumulative session cost in the chat status bar, the VS Code extension footer, and via ACP `usage_update`:

```json
{
  "name": "Haiku 4.5",
  "provider": "LiteLLM Anthropic",
  "metadata": {
    "name": "claude-haiku-4.5",
    "context": 200000,
    "costs": { "input/m": 1, "cache/m": 0.1, "output/m": 5 },
    "modality": { "text": true, "image": true, "pdf": true }
  },
  "options": { "model": "claude-haiku-4.5" },
  "default": true
}
```

- `metadata.name` is required when the block is present, and is the identifier looked up in the [models.dev](https://models.dev) catalog (cached under `~/.hooman/cache/`, refreshed at most once daily). When `metadata` is omitted, `options.model` is used as the lookup name.
- `metadata.context` (window size in tokens) and `metadata.costs` (USD per million tokens; `"cache/m"` prices cached-input reads) override whatever models.dev resolves.
- `metadata.modality` can explicitly override the model's advertised input modalities (`text`, `image`, `pdf`, `audio`, `video`). At runtime, attachments, ACP image/audio/blob blocks, and filesystem `read_file` / `read_multiple_files` with `binary: true` all use the resolved modality (config override → models.dev → text-only). Unsupported modalities become diagnostics/text (or base64 for unknown binaries) instead of forcing media blocks the model cannot accept. Editable from `/config` and the VS Code settings editor.
- If neither the config nor models.dev yields the data, context usage and cost are simply not shown.
- For local providers (llama.cpp, MLX, Ollama), catalog costs are never applied — local inference is free, and the catalog prices the hosted API serving the same model id — so only the context window resolves and no `$` cost is displayed. An explicit `metadata.costs` block still wins if you set one.

Resolution merges config-provided metadata over the models.dev catalog: model ids are matched with separator normalization plus boundary containment (so `claude-haiku-4.5`, `anthropic/claude-sonnet-4-5`, and Bedrock's region-prefixed ids all resolve), preferring the provider whose id equals the model's canonical lab. Per-request cost is computed from additive-shape usage and accumulated at the rates of the model that served each request; once a request with usage runs unpriced, cost reporting stops for the session rather than under-reporting.

Context usage is a property of the conversation, not the model: switching models carries the `used` tokens over and rescales them against the new model's window, while accrued cost is kept.
