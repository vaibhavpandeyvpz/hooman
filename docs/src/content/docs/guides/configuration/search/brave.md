---
title: Brave
description: Configure the brave search provider — options and an example config.
---

Runtime provider id: `brave`. Calls the [Brave Search API](https://brave.com/search/api/) directly.

## Options

| Field    | Type   | Notes                                          |
| -------- | ------ | ---------------------------------------------- |
| `apiKey` | string | Required. Brave Search API subscription token. |

## Supported search parameters

Brave supports the full normalized parameter set: `count`, `freshness` (mapped to `pd`/`pw`/`pm`/`py`), `start_date`/`end_date` (mapped to a `to` range), `country`, and `safe_search` (mapped to `strict`/`off`).

## Example config

```json
{
  "search": {
    "enabled": true,
    "provider": "brave",
    "brave": { "apiKey": "BSA..." }
  }
}
```
