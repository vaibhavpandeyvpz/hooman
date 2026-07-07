import { SolidMarkdown } from "solid-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { openLink } from "../store";

const remarkPlugins = [remarkGfm, remarkBreaks];

/**
 * Intercepts clicks on rendered Markdown links so navigation never happens
 * inside the webview: `http(s)`/`mailto` links are handed to the host for
 * `vscode.env.openExternal`, and everything else (relative or absolute
 * filesystem paths, e.g. `docs/PLAN.md` or `/abs/path/file.ts`) is opened in
 * an editor tab by the host, which knows the active session's cwd.
 */
function MarkdownLink(props: { href?: string; children?: unknown }) {
  const href = () => props.href ?? "";
  return (
    <a
      href={href()}
      onClick={(event) => {
        event.preventDefault();
        if (href()) {
          openLink(href());
        }
      }}
    >
      {props.children as never}
    </a>
  );
}

/**
 * Markdown renderer for assistant messages and plan bodies.
 *
 * Uses `solid-markdown` so content is rendered as Solid elements instead of
 * being injected via `innerHTML`.
 */
export function Markdown(props: { children: string; class?: string }) {
  return (
    <SolidMarkdown
      class={`markdown-body ${props.class ?? ""}`}
      remarkPlugins={remarkPlugins}
      components={{ a: MarkdownLink }}
    >
      {props.children}
    </SolidMarkdown>
  );
}
