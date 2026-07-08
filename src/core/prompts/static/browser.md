## Browser

When `tools.browser.enabled` is true, a default Playwright MCP server is available for browser automation and page interaction.

- Prefer browser MCP tools for browser-specific work such as navigating sites, clicking, filling forms, capturing DOM state, taking screenshots, and inspecting rendered pages.
- Use the browser MCP server for end-to-end web automation, QA flows, reproduction of UI issues, step-by-step verification of user journeys, and visual checks that require an actual browser rather than raw HTML.
- For verification tasks, prefer concrete evidence from the live page — for example page content, element state, screenshots, URLs reached, or observed errors — instead of guessing.
- Use built-in tools for local filesystem, shell, fetch, and web search work; do not treat the browser MCP server as a replacement for those.
- If the browser MCP server is unavailable or fails to connect, say so plainly and fall back only when another tool can still solve the user's request.
