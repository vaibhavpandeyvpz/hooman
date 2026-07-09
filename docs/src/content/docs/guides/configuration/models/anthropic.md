---
title: Anthropic
description: Configure the anthropic provider — options, reasoning, and example configs.
---

Runtime provider id: `anthropic`. Talks to the native Anthropic Messages API.

## Provider options

| Field       | Type                     | Notes                                                                              |
| ----------- | ------------------------ | ---------------------------------------------------------------------------------- |
| `apiKey`    | string                   | Required (or set via environment).                                                 |
| `baseURL`   | string                   | Optional. Override the API endpoint.                                               |
| `headers`   | `Record<string, string>` | Optional. Extra HTTP headers.                                                      |
| `reasoning` | object                   | Optional. See [Reasoning](/hooman/guides/configuration/models/#reasoning-options). |

## Reasoning

Setting `reasoning` enables extended thinking (`thinking: { type: "enabled", budget_tokens }`); omit it entirely to leave thinking off. `effort` defaults to `medium` and always maps to an explicit `budget_tokens`:

| `effort`  | `budget_tokens` |
| --------- | --------------- |
| `minimal` | 1024            |
| `low`     | 2048            |
| `medium`  | 4096            |
| `high`    | 8192            |

`display` is **not** supported by the native Anthropic API (`api.anthropic.com`) — only Bedrock Claude and MiniMax accept it. Setting `display` here will be rejected by the API.

## Example configs

Anthropic without reasoning:

```json
{
  "name": "Anthropic",
  "provider": "anthropic",
  "options": {
    "apiKey": "sk-ant-..."
  }
}
```

```json
{
  "name": "Claude Sonnet",
  "provider": "Anthropic",
  "options": {
    "model": "claude-sonnet-4-6"
  },
  "default": true
}
```

Anthropic with extended thinking:

```json
{
  "name": "Anthropic Thinking",
  "provider": "anthropic",
  "options": {
    "apiKey": "sk-ant-...",
    "reasoning": { "effort": "high" }
  }
}
```

```json
{
  "name": "Claude Opus (thinking)",
  "provider": "Anthropic Thinking",
  "options": {
    "model": "claude-opus-4-7"
  }
}
```
