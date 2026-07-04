---
title: Search
description: Enable web search and pick a provider for the built-in web_search tool.
---

Hooman ships a `web_search` tool that normalizes results from a single configured search provider. It's off by default and controlled by the `search` block in `config.json`. Each provider page below covers its config options and one example config.

## Supported providers

| Provider                                                    | Runtime id  |
| ----------------------------------------------------------- | ----------- |
| [Brave](/hooman/guides/configuration/search/brave/)         | `brave`     |
| [Exa](/hooman/guides/configuration/search/exa/)             | `exa`       |
| [Firecrawl](/hooman/guides/configuration/search/firecrawl/) | `firecrawl` |
| [LiteLLM](/hooman/guides/configuration/search/litellm/)     | `litellm`   |
| [Serper](/hooman/guides/configuration/search/serper/)       | `serper`    |
| [Tavily](/hooman/guides/configuration/search/tavily/)       | `tavily`    |

## Shared shape

```json
{
  "search": {
    "enabled": true,
    "provider": "tavily",
    "tavily": { "apiKey": "tvly-..." }
  }
}
```

- `search.enabled` (boolean) — turns the `web_search` tool on or off.
- `search.provider` — the runtime id of one of the providers above.
- A per-provider block carrying that provider's own options (usually just `apiKey`).

The `/config` in-chat workflow can also set the search provider and its API key — see [`/config`](/hooman/guides/cli/#config).

## Shared search parameters

Regardless of provider, the agent calls `web_search` with a normalized input shape and gets back normalized results:

| Input field               | Notes                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| `query`                   | Required search query (max 400 chars).                                                   |
| `count`                   | Result count, 1–20 (default 5).                                                          |
| `freshness`               | `"day" \| "week" \| "month" \| "year"`. Mutually exclusive with `start_date`/`end_date`. |
| `start_date` / `end_date` | `YYYY-MM-DD`, must be provided together.                                                 |
| `country`                 | Two-letter country code.                                                                 |
| `safe_search`             | Boolean.                                                                                 |

Every provider returns the same normalized `{ provider, query, results: [{ title, url, snippet }], metadata }` shape; not every provider supports every input field (each provider page notes the gaps).

Search requests use a 20-second timeout by default; `firecrawl` and `litellm` get a longer 60-second timeout since a search+scrape round trip can take longer.
