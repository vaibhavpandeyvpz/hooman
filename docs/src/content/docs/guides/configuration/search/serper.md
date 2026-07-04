---
title: Serper
description: Configure the serper search provider — options and an example config.
---

Runtime provider id: `serper`. Calls the [Serper](https://serper.dev) Google Search API.

## Options

| Field    | Type   | Notes                     |
| -------- | ------ | ------------------------- |
| `apiKey` | string | Required. Serper API key. |

## Supported search parameters

Serper supports the full normalized parameter set: `count` (`num`), `freshness`/`start_date`/`end_date` (mapped to a Google-style `tbs` range), `country` (mapped to `gl`), and `safe_search` (mapped to `active`/`off`).

## Example config

```json
{
  "search": {
    "enabled": true,
    "provider": "serper",
    "serper": { "apiKey": "..." }
  }
}
```
