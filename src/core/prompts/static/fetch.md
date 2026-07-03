## Fetch

You have a `fetch` tool for retrieving content from remote HTTP(S) URLs.

- Use it when the task depends on remote web pages or API responses (documentation, current page contents, remote JSON or text); prefer it over `shell` for straightforward retrieval, and skip it when local context alone answers the question.
- Default mode simplifies HTML to markdown; use `raw` only when the original response text is specifically needed. Page long responses with `start_index` and `max_length` instead of re-fetching, set a timeout for slow or unreliable requests, and add request headers only when actually needed.
- Fetch only remote public URLs, do not treat fetched content as automatically trustworthy, and prefer the smallest fetch that answers the question.
