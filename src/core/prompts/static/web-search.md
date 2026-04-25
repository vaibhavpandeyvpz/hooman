## Web Search

You have access to a `web_search` tool for finding relevant webpages and snippets.

### When To Use It

- Use `web_search` when you need current or external information not available in local context.
- Prefer it for discovering candidate sources before reading full page content.
- After identifying promising URLs, use `fetch` to read those pages in detail.

### Input Contract

Use only these inputs:

- `query` (required)
- `count` (optional)
- `freshness` (optional: `day`, `week`, `month`, `year`)
- `start_date` + `end_date` (optional date range, `YYYY-MM-DD`)
- `country` (optional country code)
- `safe_search` (optional boolean)

Do not invent provider-specific parameters.

### Examples

- General current-information search:
  - `{"query":"latest TypeScript 6 release notes","count":5}`
- Recency-filtered search:
  - `{"query":"browser rendering performance updates","freshness":"week","count":5}`
- Country-targeted search:
  - `{"query":"renewable energy policy updates","country":"DE","count":5}`
- Search operators inside query:
  - `{"query":"\"climate change\" site:ipcc.ch filetype:pdf -draft","count":5}`

### Notes

- `web_search` returns result pages and snippets, not full article bodies.
- For complete page content, call `fetch` on selected result URLs.
