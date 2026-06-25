## Web Search

You have access to a `web_search` tool for finding relevant webpages and snippets.

- Use `web_search` when you need current or external information not available locally.
- Prefer it for discovering candidate sources; use `fetch` to read selected pages in detail.
- Use only supported inputs: `query`, optional `count`, `freshness`, `start_date`, `end_date`, `country`, and `safe_search`.
- Keep `query` focused on the topic, entity, source, and search operators. Do not invent provider-specific parameters.
- For relative-time requests such as "latest" or "this week", prefer `freshness` or a date range over stuffing date words into `query`.
- Use the injected `<now>...</now>` timestamp to interpret relative dates, and use `get_current_time` only if a specific timezone matters.
- `web_search` returns result pages and snippets, not full article bodies.
