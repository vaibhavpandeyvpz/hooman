---
title: xAI
description: Configure the xai provider — options, reasoning, and example configs.
---

Runtime provider id: `xai`. Talks to the xAI (Grok) API.

## Provider options

| Field       | Type                     | Notes                                                                              |
| ----------- | ------------------------ | ---------------------------------------------------------------------------------- |
| `apiKey`    | string                   | Required (or set via environment).                                                 |
| `baseURL`   | string                   | Optional. Override the API endpoint.                                               |
| `headers`   | `Record<string, string>` | Optional. Extra HTTP headers.                                                      |
| `reasoning` | object                   | Optional. See [Reasoning](/hooman/guides/configuration/models/#reasoning-options). |

## Reasoning

`reasoning.effort` maps to xAI's `reasoning_effort` (`low`/`high`; `minimal` -> `low`, `medium` -> `high`). Only reasoning models (for example `grok-3-mini`) support it. Omit to leave reasoning at the default. `summary`/`display` are not used by xAI.

## Example configs

```json
{
  "name": "xAI",
  "provider": "xai",
  "options": {
    "apiKey": "xai-..."
  }
}
```

```json
{
  "name": "Grok 4.3",
  "provider": "xAI",
  "options": {
    "model": "grok-4.3"
  },
  "default": true
}
```

With reasoning enabled on a reasoning model:

```json
{
  "name": "xAI Reasoning",
  "provider": "xai",
  "options": {
    "apiKey": "xai-...",
    "reasoning": { "effort": "high" }
  }
}
```

```json
{
  "name": "Grok 3 Mini (thinking)",
  "provider": "xAI Reasoning",
  "options": {
    "model": "grok-3-mini"
  }
}
```
