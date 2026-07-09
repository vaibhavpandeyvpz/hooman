---
title: Google
description: Configure the google provider — options, reasoning, and example configs.
---

Runtime provider id: `google`. Talks to the Gemini API.

## Provider options

| Field       | Type   | Notes                                                                              |
| ----------- | ------ | ---------------------------------------------------------------------------------- |
| `apiKey`    | string | Required (or set via environment).                                                 |
| `reasoning` | object | Optional. See [Reasoning](/hooman/guides/configuration/models/#reasoning-options). |

Normalized `maxTokens` on the LLM entry is mapped internally to the SDK's `maxOutputTokens`.

## Reasoning

Setting `reasoning.effort` enables Gemini thinking (`thinkingConfig: { includeThoughts: true, thinkingBudget: -1 }` — dynamic budget); omit `reasoning` to leave thinking at the model default. `summary`/`display` are not used by Google.

## Example configs

```json
{
  "name": "Google",
  "provider": "google",
  "options": {
    "apiKey": "..."
  }
}
```

```json
{
  "name": "Gemini Flash",
  "provider": "Google",
  "options": {
    "model": "gemini-2.5-flash",
    "maxTokens": 8192
  },
  "default": true
}
```

With thinking enabled:

```json
{
  "name": "Google Thinking",
  "provider": "google",
  "options": {
    "apiKey": "...",
    "reasoning": { "effort": "high" }
  }
}
```

```json
{
  "name": "Gemini Flash (thinking)",
  "provider": "Google Thinking",
  "options": {
    "model": "gemini-2.5-flash"
  }
}
```
