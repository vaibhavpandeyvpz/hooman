---
title: Exa
description: Configure the exa search provider — options and an example config.
---

Runtime provider id: `exa`. Uses the [Exa](https://exa.ai) SDK's neural/auto search with highlights.

## Options

| Field    | Type   | Notes                  |
| -------- | ------ | ---------------------- |
| `apiKey` | string | Required. Exa API key. |

## Supported search parameters

Exa supports `count` (`numResults`), `freshness`/`start_date`/`end_date` (mapped to `startPublishedDate`/`endPublishedDate`), `country` (mapped to `userLocation`), and `safe_search: true` (enables `moderation`). Snippets prefer highlighted passages, falling back to the result summary or full text.

## Example config

```json
{
  "search": {
    "enabled": true,
    "provider": "exa",
    "exa": { "apiKey": "..." }
  }
}
```
