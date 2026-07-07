import { SolidMarkdown } from "solid-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

const remarkPlugins = [remarkGfm, remarkBreaks];

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
    >
      {props.children}
    </SolidMarkdown>
  );
}
