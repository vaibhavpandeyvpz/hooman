---
title: OpenAI
description: Configure the openai provider — options, reasoning, and example configs.
---

Runtime provider id: `openai`. Defaults to the OpenAI Responses API.

## Provider options

| Field       | Type                     | Notes                                                                                                                  |
| ----------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `apiKey`    | string                   | Required (or set via environment).                                                                                     |
| `baseURL`   | string                   | Optional. Override the API endpoint.                                                                                   |
| `headers`   | `Record<string, string>` | Optional. Extra HTTP headers.                                                                                          |
| `api`       | `"responses" \| "chat"`  | Optional. Which OpenAI-compatible API surface to use; defaults to `"responses"`.                                       |
| `reasoning` | object                   | Optional. See [Reasoning](/hooman/guides/configuration/models/#reasoning-options). Only honored on `api: "responses"`. |

`api: "responses"` (the default) streams reasoning (`response.reasoning_summary_text.delta`) so it shows up in the UI. `api: "chat"` is for OpenAI-compatible MaaS/proxies that do not implement the Responses API — it does **not** surface reasoning, since the SDK's Chat adapter drops `reasoning_content`. For a proxy that only exposes thinking via chat `reasoning_content` (e.g. Kimi/Moonshot), route it through [`moonshot`](/hooman/guides/configuration/models/moonshot/) or [`openrouter`](/hooman/guides/configuration/models/openrouter/) instead.

## Reasoning

Reasoning controls only apply to the Responses API (`api: "responses"`):

- `effort`: reasoning effort. Some models (e.g. GPT-5) only emit a reasoning summary at `medium` or `high`; `low`/`minimal` yield no visible thinking.
- `summary`: summary verbosity. Defaults to `auto`. Set to `none` to disable summaries (e.g. for non-reasoning models that reject the `reasoning` param).
- `display` is not used by OpenAI.

## Example configs

```json
{
  "name": "OpenAI",
  "provider": "openai",
  "options": {
    "apiKey": "sk-..."
  }
}
```

```json
{
  "name": "OpenAI Reasoning",
  "provider": "openai",
  "options": {
    "apiKey": "sk-...",
    "reasoning": { "effort": "high", "summary": "detailed" }
  }
}
```

```json
{
  "name": "GPT-5",
  "provider": "OpenAI Reasoning",
  "options": {
    "model": "gpt-5"
  },
  "default": true
}
```

Chat Completions mode against an OpenAI-compatible proxy that doesn't implement Responses:

```json
{
  "name": "OpenAI Proxy",
  "provider": "openai",
  "options": {
    "apiKey": "sk-...",
    "baseURL": "https://litellm.internal/v1",
    "api": "chat"
  }
}
```

```json
{
  "name": "GPT-4o (Chat API)",
  "provider": "OpenAI Proxy",
  "options": {
    "model": "gpt-4o"
  }
}
```
