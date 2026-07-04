---
title: MiniMax
description: Configure the minimax provider — options, reasoning, and example configs.
---

Runtime provider id: `minimax`. Served through the AI SDK Anthropic adapter (`@ai-sdk/anthropic` via the Strands `VercelModel`), because it reads token usage from the stream's final `message_delta` — MiniMax reports `input_tokens: 0` in `message_start`, which the native Anthropic model would trust.

## Provider options

| Field       | Type                     | Notes                                                                                                                                                   |
| ----------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiKey`    | string                   | Required (or set via environment).                                                                                                                      |
| `baseURL`   | string                   | Optional. Defaults to the Anthropic-compatible endpoint `https://api.minimax.io/anthropic`; override to reach MiniMax through a gateway (e.g. LiteLLM). |
| `headers`   | `Record<string, string>` | Optional. Extra HTTP headers.                                                                                                                           |
| `reasoning` | object                   | Optional. See [Reasoning](/hooman/guides/configuration/models/#reasoning-options).                                                                      |

## Reasoning

Providing `reasoning` enables MiniMax's adaptive thinking (`thinking: { type: "adaptive" }` with `output_config.effort`); omit `reasoning` to leave thinking at the model default. `effort` defaults to `medium` (`minimal` maps to `low`); `display` is forwarded when set (MiniMax accepts `display`, unlike the native Anthropic API).

## Example configs

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

Through a LiteLLM gateway, with reasoning display:

```json
{
  "name": "MiniMax via LiteLLM",
  "provider": "minimax",
  "options": {
    "apiKey": "...",
    "baseURL": "https://litellm.internal/anthropic",
    "reasoning": { "effort": "high", "display": "summarized" }
  }
}
```

```json
{
  "name": "MiniMax M3 (thinking)",
  "provider": "MiniMax via LiteLLM",
  "options": {
    "model": "MiniMax-M3"
  }
}
```
