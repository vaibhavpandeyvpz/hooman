---
title: Providers & Models
description: Supported LLM providers, reasoning options, and billing metadata for cost/context tracking.
---

Provider entries carry a runtime `provider` id plus provider-specific `options`; LLM entries reference a provider by name and carry normalized model options.

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

## Supported providers

`anthropic`, `azure`, `bedrock`, `google`, `groq`, `minimax`, `moonshot`, `ollama`, `openai`, `openrouter`, `xai`.

All reasoning-capable providers share a common optional `reasoning` object: `{ effort?, summary?, display? }`.

- `effort` is `"minimal" | "low" | "medium" | "high"` and its presence enables thinking; Hooman translates it to each backend's native shape.
- `summary` (`"auto" | "concise" | "detailed" | "none"`) is only honored by the OpenAI/Azure Responses API.
- `display` (`"summarized" | "omitted"`) applies to Bedrock Claude / MiniMax only.

| Provider     | Option fields                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `anthropic`  | `apiKey`, optional `baseURL`, optional `headers`, optional `reasoning`                                                                                             |
| `azure`      | optional `resourceName`, optional `baseURL`, optional `apiKey`, optional `headers`, optional `apiVersion`, optional `useDeploymentBasedUrls`, optional `reasoning` |
| `bedrock`    | `region`, `accessKeyId`, `secretAccessKey`, optional `sessionToken`, optional `apiKey`, optional `reasoning`                                                       |
| `google`     | `apiKey`, optional `reasoning`                                                                                                                                     |
| `groq`       | `apiKey`, optional `baseURL`, optional `headers`, optional `reasoning`                                                                                             |
| `minimax`    | `apiKey`, optional `headers`, optional `reasoning`                                                                                                                 |
| `moonshot`   | `apiKey`, optional `baseURL`, optional `headers`, optional `reasoning`                                                                                             |
| `ollama`     | optional `baseURL`, optional `reasoning`                                                                                                                           |
| `openai`     | `apiKey`, optional `baseURL`, optional `headers`, optional `api` (`"responses"` default or `"chat"`), optional `reasoning`                                         |
| `openrouter` | `apiKey`, optional `baseURL`, optional `headers`, optional `reasoning`                                                                                             |
| `xai`        | `apiKey`, optional `baseURL`, optional `headers`, optional `reasoning`                                                                                             |

Normalized LLM option fields: `model`, optional `temperature`, optional `maxTokens`.

## Provider notes

- Google maps normalized `maxTokens` to the SDK's `maxOutputTokens` internally.
- Azure uses the Vercel AI SDK `@ai-sdk/azure` provider. Set the LLM `model` to your Azure **deployment name**, not the raw OpenAI model id.
- Ollama maps normalized `temperature` into Ollama `options.temperature`.
- MiniMax uses the Anthropic-compatible endpoint `https://api.minimax.io/anthropic` automatically.
- Moonshot defaults `baseURL` to `https://api.moonshot.ai/v1` when omitted. It's served through the reasoning-aware openai-compatible adapter, so Kimi's `reasoning_content` streams as thinking — the right provider for reaching Kimi through an OpenAI-compatible proxy (e.g. LiteLLM), where the `openai` provider's Chat adapter would drop reasoning.
- OpenRouter defaults `baseURL` to `https://openrouter.ai/api/v1` when omitted; model names are usually provider-qualified ids such as `anthropic/claude-3.5-sonnet`. It also uses the openai-compatible adapter, so reasoning streams for reasoning models.
- The `openai` provider defaults to the Responses API (`api: "responses"`), which surfaces reasoning. `api: "chat"` does **not** surface reasoning — route such proxies through `moonshot`/`openrouter` instead.
- `reasoning.display` is for Bedrock Claude (Opus 4.7+ hide reasoning by default) and MiniMax; the native Anthropic API rejects it.
- Bedrock can rely on the AWS default credential chain when explicit credentials are not provided.

## Search providers

`brave`, `exa`, `firecrawl`, `serper`, `tavily` — enabled via `search.enabled` / `search.provider` and a per-provider `apiKey`. See [CLI feature flags](/hooman/guides/cli/#feature-flags).

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
- If neither the config nor models.dev yields the data, context usage and cost are simply not shown (this is the default for local models like Ollama).

Resolution merges config-provided fields over the models.dev catalog: model ids are matched with separator normalization plus boundary containment (so `claude-haiku-4.5`, `anthropic/claude-sonnet-4-5`, and Bedrock's region-prefixed ids all resolve), preferring the provider whose id equals the model's canonical lab. Per-request cost is computed from additive-shape usage and accumulated at the rates of the model that served each request; once a request with usage runs unpriced, cost reporting stops for the session rather than under-reporting.

Context usage is a property of the conversation, not the model: switching models carries the `used` tokens over and rescales them against the new model's window, while accrued cost is kept.
