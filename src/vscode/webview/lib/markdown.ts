import { marked } from "marked";

marked.setOptions({ gfm: true, breaks: true });

/** Render assistant markdown to sanitized-by-construction HTML (webview CSP has no inline scripts, and marked doesn't emit any). */
export function renderMarkdown(source: string): string {
  return marked.parse(source, { async: false }) as string;
}
