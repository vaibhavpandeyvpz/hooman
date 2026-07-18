import type { ReactNode } from "react";

/**
 * Minimal, safe Markdown-ish renderer: fenced code blocks, inline code,
 * bold/italic, and `https://`/`http://` links only. Deliberately does not
 * parse or inject raw HTML (model output is untrusted) — this covers the
 * common subset without a `dangerouslySetInnerHTML` + sanitizer dependency.
 */
export function Markdown({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className={className}>
      {blocks.map((block, i) => renderBlock(block, i))}
    </div>
  );
}

function renderBlock(block: string, key: number): ReactNode {
  const fenceMatch = block.match(/^```(\w*)\n([\s\S]*?)```$/);
  if (fenceMatch) {
    return (
      <pre
        key={key}
        className="my-1.5 overflow-x-auto rounded-md bg-black/40 p-2.5 text-[12px] leading-relaxed"
      >
        <code>{fenceMatch[2]}</code>
      </pre>
    );
  }
  return (
    <p key={key} className="whitespace-pre-wrap [&:not(:first-child)]:mt-2">
      {renderInline(block)}
    </p>
  );
}

const INLINE_PATTERN =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(https?:\/\/[^\s)]+)/g;

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  INLINE_PATTERN.lastIndex = 0;
  while ((match = INLINE_PATTERN.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const [full, code, bold, italic, url] = match;
    if (code) {
      nodes.push(
        <code
          key={key++}
          className="rounded bg-slate-800 px-1 py-0.5 text-[12px]"
        >
          {code.slice(1, -1)}
        </code>,
      );
    } else if (bold) {
      nodes.push(<strong key={key++}>{bold.slice(2, -2)}</strong>);
    } else if (italic) {
      nodes.push(<em key={key++}>{italic.slice(1, -1)}</em>);
    } else if (url) {
      nodes.push(
        <a
          key={key++}
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-hooman-secondary underline hover:text-hooman-primary"
        >
          {url}
        </a>,
      );
    } else {
      nodes.push(full);
    }
    lastIndex = match.index + full.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}
