---
title: LiteLLM
description: Configure the litellm search provider — options and an example config.
---

Runtime provider id: `litellm`. Routes search through a [LiteLLM](https://www.litellm.ai) proxy's `/v1/search/<tool>` endpoint — useful for centralizing search credentials/routing behind a gateway you already run for models.

## Options

| Field     | Type   | Notes                                                                                       |
| --------- | ------ | ------------------------------------------------------------------------------------------- |
| `baseURL` | string | Required. Base URL of the LiteLLM proxy.                                                    |
| `apiKey`  | string | Required. Bearer token for the proxy.                                                       |
| `tool`    | string | Required. The underlying search tool name the proxy should invoke (e.g. `"tavily_search"`). |

## Supported search parameters

LiteLLM supports `count` (`max_results`) and `country`. `freshness`, `start_date`/`end_date`, and `safe_search` are not forwarded. Requests use the longer 60-second timeout shared with `firecrawl`.

## Example config

```json
{
  "search": {
    "enabled": true,
    "provider": "litellm",
    "litellm": {
      "baseURL": "https://litellm.internal",
      "apiKey": "sk-litellm-...",
      "tool": "tavily_search"
    }
  }
}
```
