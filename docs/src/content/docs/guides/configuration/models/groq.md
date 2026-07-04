---
title: Groq
description: Configure the groq provider — options, reasoning, and example configs.
---

Runtime provider id: `groq`. Talks to the Groq API.

## Provider options

| Field       | Type                     | Notes                                                                              |
| ----------- | ------------------------ | ---------------------------------------------------------------------------------- |
| `apiKey`    | string                   | Required (or set via environment).                                                 |
| `baseURL`   | string                   | Optional. Override the API endpoint.                                               |
| `headers`   | `Record<string, string>` | Optional. Extra HTTP headers.                                                      |
| `reasoning` | object                   | Optional. See [Reasoning](/hooman/guides/configuration/models/#reasoning-options). |

## Reasoning

`reasoning.effort` maps to Groq's `reasoning_effort` (`minimal` is sent as `low`); reasoning is streamed via `reasoning_format: "parsed"`. Omit `reasoning` to leave it at the model default. `summary`/`display` are not used by Groq.

## Example configs

```json
{
  "name": "Groq",
  "provider": "groq",
  "options": {
    "apiKey": "gsk_..."
  }
}
```

```json
{
  "name": "Llama 4 (Groq)",
  "provider": "Groq",
  "options": {
    "model": "llama-4-maverick"
  },
  "default": true
}
```

With reasoning enabled on a reasoning-capable model:

```json
{
  "name": "Groq Reasoning",
  "provider": "groq",
  "options": {
    "apiKey": "gsk_...",
    "reasoning": { "effort": "medium" }
  }
}
```

```json
{
  "name": "Qwen QwQ (Groq)",
  "provider": "Groq Reasoning",
  "options": {
    "model": "qwen-qwq-32b"
  }
}
```
