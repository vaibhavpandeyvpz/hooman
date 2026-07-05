---
title: Models
description: The shared provider/LLM config shape, reasoning options, and billing metadata for cost/context tracking.
---

Hooman's `config.json` splits model configuration into two arrays: reusable `providers` (credentials and provider-level options) and `llms` (named model presets that reference a provider by name). Each provider page below covers its `options` fields, reasoning support, and one or two example configs.

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

Every `llms` entry, regardless of provider, carries the same normalized `options` shape: `model` (required), optional `temperature`, optional `maxTokens` (Google maps this to the SDK's `maxOutputTokens`), and optional `context` (context size in tokens — only honored by the [llama.cpp provider](/hooman/guides/configuration/models/llama-cpp/), where it overrides the provider-level `context`; other providers ignore it).

All reasoning-capable providers additionally share a common optional `reasoning` object on the **provider** `options`: `{ effort?, summary?, display? }`. `effort` (`"minimal" | "low" | "medium" | "high"`) enables thinking; `summary` (OpenAI/Azure Responses API only) controls summary verbosity; `display` (Bedrock Claude / MiniMax only) controls whether the reasoning trace is returned. Each provider page documents its exact mapping.

## Billing metadata

Each LLM entry may carry an optional `billing` block used to display context-window utilization and cumulative session cost in the chat status bar, the VS Code extension footer, and via ACP `usage_update`:

```json
{
  "name": "Haiku 4.5",
  "provider": "LiteLLM Anthropic",
  "billing": {
    "name": "claude-haiku-4.5",
    "context": 200000,
    "costs": { "input/m": 1, "cache/m": 0.1, "output/m": 5 }
  },
  "options": { "model": "claude-haiku-4.5" },
  "default": true
}
```

- `billing.name` is required when the block is present, and is the identifier looked up in the [models.dev](https://models.dev) catalog (cached under `~/.hooman/cache/`, refreshed at most once daily). When `billing` is omitted, `options.model` is used as the lookup name.
- `context` (window size in tokens) and `costs` (USD per million tokens; `"cache/m"` prices cached-input reads) override whatever models.dev resolves.
- If neither the config nor models.dev yields the data, context usage and cost are simply not shown.
- For local providers (llama.cpp, MLX, Ollama), catalog costs are never applied — local inference is free, and the catalog prices the hosted API serving the same model id — so only the context window resolves and no `$` cost is displayed. An explicit `billing.costs` block still wins if you set one.

Resolution merges config-provided fields over the models.dev catalog: model ids are matched with separator normalization plus boundary containment (so `claude-haiku-4.5`, `anthropic/claude-sonnet-4-5`, and Bedrock's region-prefixed ids all resolve), preferring the provider whose id equals the model's canonical lab. Per-request cost is computed from additive-shape usage and accumulated at the rates of the model that served each request; once a request with usage runs unpriced, cost reporting stops for the session rather than under-reporting.

Context usage is a property of the conversation, not the model: switching models carries the `used` tokens over and rescales them against the new model's window, while accrued cost is kept.
