---
title: Ollama
description: Configure the ollama provider — options, reasoning, and example configs.
---

Runtime provider id: `ollama`. Talks to a local (or remote) Ollama instance. This is Hooman's default out-of-the-box provider — no API key required.

## Provider options

| Field       | Type   | Notes                                                                              |
| ----------- | ------ | ---------------------------------------------------------------------------------- |
| `baseURL`   | string | Optional. Defaults to the local Ollama instance.                                   |
| `reasoning` | object | Optional. See [Reasoning](/hooman/guides/configuration/models/#reasoning-options). |

Normalized `temperature` on the LLM entry is mapped into Ollama's `options.temperature`.

## Reasoning

Setting `reasoning.effort` enables Ollama thinking, mapped to the `think` level (`minimal`/`low` -> `"low"`, `medium` -> `"medium"`, `high` -> `"high"`); omit to leave thinking off. `summary`/`display` are not used by Ollama.

## Example configs

Default local instance (matches the out-of-the-box `config.json`):

```json
{
  "name": "Ollama",
  "provider": "ollama",
  "options": {}
}
```

```json
{
  "name": "Default",
  "provider": "Ollama",
  "options": {
    "model": "gemma4:e4b"
  },
  "default": true
}
```

Remote instance, with thinking enabled on a reasoning-capable local model:

```json
{
  "name": "Ollama Remote",
  "provider": "ollama",
  "options": {
    "baseURL": "http://ollama.internal:11434",
    "reasoning": { "effort": "medium" }
  }
}
```

```json
{
  "name": "Qwen3 (thinking)",
  "provider": "Ollama Remote",
  "options": {
    "model": "qwen3:32b",
    "temperature": 0.7
  }
}
```
