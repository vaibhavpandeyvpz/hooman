---
title: Moonshot
description: Configure the moonshot provider — options, reasoning, and example configs.
---

Runtime provider id: `moonshot`. Served through the reasoning-aware openai-compatible adapter, so Kimi's `reasoning_content` streams as thinking — the right provider for reaching Kimi through an OpenAI-compatible proxy (e.g. LiteLLM), where the `openai` provider's Chat adapter would drop reasoning.

## Provider options

| Field       | Type                     | Notes                                                                              |
| ----------- | ------------------------ | ---------------------------------------------------------------------------------- |
| `apiKey`    | string                   | Required (or set via environment).                                                 |
| `baseURL`   | string                   | Optional. Defaults to `https://api.moonshot.ai/v1` when omitted.                   |
| `headers`   | `Record<string, string>` | Optional. Extra HTTP headers.                                                      |
| `reasoning` | object                   | Optional. See [Reasoning](/hooman/guides/configuration/models/#reasoning-options). |

## Reasoning

Setting `reasoning.effort` enables Kimi thinking (`thinking: { type: "enabled" }`); omit to leave thinking off. `summary`/`display` are not used by Moonshot.

## Example configs

```json
{
  "name": "Moonshot",
  "provider": "moonshot",
  "options": {
    "apiKey": "sk-..."
  }
}
```

```json
{
  "name": "Kimi K2",
  "provider": "Moonshot",
  "options": {
    "model": "kimi-k2-0905-preview"
  },
  "default": true
}
```

Through an OpenAI-compatible proxy (e.g. LiteLLM), with thinking enabled:

```json
{
  "name": "Kimi via Proxy",
  "provider": "moonshot",
  "options": {
    "apiKey": "sk-...",
    "baseURL": "https://litellm.internal/v1",
    "reasoning": { "effort": "high" }
  }
}
```

```json
{
  "name": "Kimi K2 (thinking)",
  "provider": "Kimi via Proxy",
  "options": {
    "model": "kimi-k2-thinking"
  }
}
```
