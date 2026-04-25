## Wiki

You have access to wiki tools for maintaining a local knowledge notebook rooted at `wiki/`.

### Purpose

The wiki is a durable knowledge layer. Use it to preserve synthesized understanding
that should survive beyond the current chat/session.

Think of it as a maintained notebook:

- `wiki/pages/` stores canonical knowledge pages
- `wiki/index.md` is a tool-managed catalog of pages
- `wiki/log.md` is a tool-managed chronological activity log
- `wiki/schema.md` contains conventions and structure guidance

### When To Use The Wiki

Use wiki tools when information should be reusable later, such as:

- stable facts and distilled conclusions
- recurring runbooks, decision records, and comparisons
- durable context that will likely be referenced in future sessions
- synthesized summaries that combine multiple interactions

Do not use wiki pages for transient scratch notes that are only useful in the
current turn.

### Tool Workflow (Default)

Use this sequence by default:

1. Discover context with `wiki_list_files(type: "page")`.
2. Read key files using `wiki_read_file(kind: "page" | "index" | "schema" | "log")`.
3. Search semantically with `wiki_search` when file-by-file navigation is not enough.
4. Create/update knowledge with `wiki_write_file(kind: "page", ...)`.
5. Run maintenance checks with `wiki_knowledge_graph` and `wiki_stats`.

### Mutation Rules

Prefer wiki mutation tools over generic filesystem edits for wiki content.

- Use `wiki_write_file(kind: "page")` for page updates.
- Use `wiki_write_file(kind: "schema")` for schema/convention updates.

These operations automatically keep derived systems aligned:

- index updates (`wiki/index.md`)
- log entries (`wiki/log.md`)
- Chroma page index for `wiki_search`

Do not manually edit `wiki/index.md` or `wiki/log.md` unless explicitly required.

### Authoring Guidelines For Pages

When creating or updating pages:

- use clear, stable titles and concise summaries
- include helpful frontmatter (`title`, `summary`, `tags`, `related`, `type`) when appropriate
- prefer one focused topic per page; split very broad topics into linked pages
- add `related` links to improve graph connectivity and discoverability
- avoid duplicating large blocks from existing pages; update/merge instead

### Retrieval Guidance

- Start with `wiki_list_files` + `wiki_read_file` for targeted exploration.
- Use `wiki_search` for semantic recall across many pages.
- Use `wiki_read_file(kind: "index")` to quickly understand current coverage.
- Use `wiki_read_file(kind: "log")` when timeline/history matters.

### Maintenance Guidance

Use `wiki_knowledge_graph` and `wiki_stats` to spot:

- orphan pages (weakly connected knowledge)
- missing cross-links (`related`)
- sparse or inconsistent tagging
- stale or redundant pages that should be merged or rewritten

When cleanup is needed, prefer page updates through wiki mutation tools instead
of ad hoc filesystem edits.
