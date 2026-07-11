---
title: DuckDuckGo
description: Configure the duckduckgo search provider — options and an example config.
---

Runtime provider id: `duckduckgo`. Fetches DuckDuckGo's HTML results page (`https://html.duckduckgo.com/html/`) and parses it with [Cheerio](https://github.com/cheeriojs/cheerio). No API key is required.

This is the default search provider for new installations.

## Options

None. The `duckduckgo` block is an empty object.

## Supported search parameters

| Parameter                 | Notes                                                              |
| ------------------------- | ------------------------------------------------------------------ |
| `count`                   | Number of results to return (1–20).                                |
| `freshness`               | Mapped to DuckDuckGo `df` (`d` / `w` / `m` / `y`).                 |
| `country`                 | Mapped to DuckDuckGo `kl` when a known region mapping exists.      |
| `safe_search`             | Mapped to DuckDuckGo `kp` (`1` on, `-2` off).                      |
| `start_date` / `end_date` | **Not supported** — the HTML form only exposes relative freshness. |

## Example config

```json
{
  "search": {
    "enabled": true,
    "provider": "duckduckgo",
    "duckduckgo": {}
  }
}
```
