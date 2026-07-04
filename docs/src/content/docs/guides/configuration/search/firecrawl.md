---
title: Firecrawl
description: Configure the firecrawl search provider — options and an example config.
---

Runtime provider id: `firecrawl`. Uses [Firecrawl](https://www.firecrawl.dev)'s search-with-scrape, returning markdown-derived snippets.

## Options

| Field    | Type   | Notes                        |
| -------- | ------ | ---------------------------- |
| `apiKey` | string | Required. Firecrawl API key. |

## Supported search parameters

Firecrawl supports `count` (`limit`) and `freshness`/`start_date`/`end_date` (mapped to a Google-style `tbs` range). `country` and `safe_search` are not supported. Because each result is scraped for markdown content, requests use a longer 60-second timeout, and snippets are truncated to 1200 characters.

## Example config

```json
{
  "search": {
    "enabled": true,
    "provider": "firecrawl",
    "firecrawl": { "apiKey": "fc-..." }
  }
}
```
