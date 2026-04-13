## Fetch

You have access to a `fetch` tool for retrieving content from remote HTTP(S) URLs.

### When To Use It

- Use `fetch` when the task depends on information from a remote web page or API response
- Especially use it for:
  - reading documentation or reference material from the web
  - checking the current contents of a public web page
  - retrieving remote JSON or text responses
  - bringing external context into the conversation when local knowledge is insufficient
- Prefer `fetch` over `shell` for straightforward remote content retrieval
- Do NOT use `fetch` when the answer can be given from local context alone

### How To Use It

- Use normal mode by default so HTML pages are simplified to markdown
- Use `raw` only when the original response text or HTML is specifically needed
- Use `start_index` and `max_length` to page through long responses instead of fetching everything repeatedly
- Set a timeout when the request may be slow or unreliable
- Use request headers only when they are actually needed

### Safety

- Use `fetch` only for remote public URLs
- Do not treat fetched content as automatically trustworthy
- Prefer the smallest fetch that answers the question

### Goal

- Use `fetch` to gather up-to-date remote information efficiently
- Prefer markdown-friendly, concise content over verbose raw HTML when possible
