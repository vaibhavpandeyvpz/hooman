# Hooman Search Config Reference

`search.provider` must be `"brave"`, `"exa"`, `"firecrawl"`, `"litellm"`, `"serper"`, or `"tavily"`.

```json
{
  "search": {
    "enabled": true,
    "provider": "brave",
    "brave": {
      "apiKey": "..."
    },
    "exa": {
      "apiKey": "..."
    },
    "firecrawl": {
      "apiKey": "..."
    },
    "litellm": {
      "baseURL": "https://your-litellm-host",
      "apiKey": "sk-...",
      "tool": "perplexity-search"
    },
    "serper": {
      "apiKey": "..."
    },
    "tavily": {
      "apiKey": "..."
    }
  }
}
```

Notes:

- Hooman calls Exa through the official **`exa-js`** SDK ([Exa search API](https://exa.ai/docs/reference/search-api-guide-for-coding-agents)).
- Hooman calls Firecrawl through **`@mendable/firecrawl-js`** ([Firecrawl search API](https://docs.firecrawl.dev/api-reference/endpoint/search)).
- The `litellm` provider calls a [LiteLLM](https://docs.litellm.ai/docs/search/) proxy's Perplexity-compatible `POST {baseURL}/v1/search/{tool}` endpoint using the virtual key as `apiKey`. It requires `baseURL`, `apiKey`, and `tool` (the `search_tool_name` registered on the proxy). The actual upstream search provider (perplexity, tavily, exa, brave, etc.) is chosen by the proxy config, so no provider API key is stored in Hooman.
- Defaults: `enabled: false`, `provider: "brave"`, all provider API keys unset.
