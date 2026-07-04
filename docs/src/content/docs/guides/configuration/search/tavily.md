---
title: Tavily
description: Configure the tavily search provider — options and an example config.
---

Runtime provider id: `tavily`. Uses the [Tavily](https://tavily.com) search SDK, built for LLM-facing search.

## Options

| Field    | Type   | Notes                     |
| -------- | ------ | ------------------------- |
| `apiKey` | string | Required. Tavily API key. |

## Supported search parameters

Tavily supports the full normalized parameter set: `count` (`max_results`), `freshness` (mapped to `time_range`), `start_date`/`end_date` (passed through directly), `country` (mapped to a display region name), and `safe_search`.

## Example config

```json
{
  "search": {
    "enabled": true,
    "provider": "tavily",
    "tavily": { "apiKey": "tvly-..." }
  }
}
```
