---
title: OpenRouter
description: Configure the openrouter provider — options, reasoning, and example configs.
---

Runtime provider id: `openrouter`. Uses the openai-compatible adapter, so reasoning streams for reasoning models.

## Provider options

| Field       | Type                     | Notes                                                                              |
| ----------- | ------------------------ | ---------------------------------------------------------------------------------- |
| `apiKey`    | string                   | Required (or set via environment).                                                 |
| `baseURL`   | string                   | Optional. Defaults to `https://openrouter.ai/api/v1` when omitted.                 |
| `headers`   | `Record<string, string>` | Optional. Extra HTTP headers.                                                      |
| `reasoning` | object                   | Optional. See [Reasoning](/hooman/guides/configuration/models/#reasoning-options). |

Model names are usually provider-qualified ids such as `anthropic/claude-sonnet-4-5`.

## Reasoning

`reasoning.effort` maps to `reasoning_effort`, which OpenRouter normalizes for reasoning models. Omit to leave reasoning at the default. `summary`/`display` are not used by OpenRouter.

## Example configs

```json
{
  "name": "OpenRouter",
  "provider": "openrouter",
  "options": {
    "apiKey": "sk-or-..."
  }
}
```

```json
{
  "name": "Gemma via OpenRouter",
  "provider": "OpenRouter",
  "options": {
    "model": "google/gemma-4-26b-a4b-it:free"
  },
  "default": true
}
```

With reasoning enabled on a reasoning model:

```json
{
  "name": "OpenRouter Reasoning",
  "provider": "openrouter",
  "options": {
    "apiKey": "sk-or-...",
    "reasoning": { "effort": "high" }
  }
}
```

```json
{
  "name": "DeepSeek R1 via OpenRouter",
  "provider": "OpenRouter Reasoning",
  "options": {
    "model": "deepseek/deepseek-r1"
  }
}
```
