import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { SolidMarkdown } from "solid-markdown";
import mermaid from "mermaid";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { openLink } from "../store";

const remarkPlugins = [remarkGfm, remarkBreaks];

function cssVar(name: string, fallback = ""): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

type HastNode = {
  type?: string;
  value?: string;
  tagName?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
};

/** Concatenate the raw text content of a hast element (its `text` descendants). */
function hastText(node: HastNode | undefined): string {
  if (!node) {
    return "";
  }
  if (node.type === "text") {
    return node.value ?? "";
  }
  return (node.children ?? []).map((child) => hastText(child)).join("");
}

/** Read the `language-xxx` class name off a hast code node. */
function hastLanguage(node: HastNode | undefined): string | undefined {
  const raw = node?.properties?.className;
  const classes = Array.isArray(raw)
    ? raw.map(String)
    : typeof raw === "string"
      ? raw.split(/\s+/)
      : [];
  return classes
    .find((name) => name.startsWith("language-"))
    ?.slice("language-".length)
    .toLowerCase();
}

async function renderMermaidDiagram(code: string): Promise<string> {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    themeVariables: {
      background: cssVar("--color-background", "#1e1e1e"),
      primaryColor: cssVar("--color-primary", "#0091cd"),
      primaryTextColor: cssVar("--color-foreground", "#cccccc"),
      primaryBorderColor: cssVar("--color-secondary", "#56a0d3"),
      lineColor: cssVar("--color-muted", "#999999"),
      textColor: cssVar("--color-foreground", "#cccccc"),
      mainBkg: cssVar("--color-panel", "#252526"),
      secondBkg: cssVar("--color-code-bg", "#1f1f1f"),
      tertiaryColor: cssVar("--color-info", "#c4dff6"),
      clusterBkg: cssVar("--color-background", "#1e1e1e"),
      clusterBorder: cssVar("--color-border", "#3c3c3c"),
      defaultLinkColor: cssVar("--color-muted", "#999999"),
      edgeLabelBackground: cssVar("--color-background", "#1e1e1e"),
      fontFamily: cssVar("--font-sans", "sans-serif"),
    },
    flowchart: {
      useMaxWidth: true,
      htmlLabels: true,
    },
  });
  const id = `hooman-mermaid-${Math.random().toString(36).slice(2)}`;
  const { svg, bindFunctions } = await mermaid.render(id, code);
  const host = document.createElement("div");
  host.innerHTML = svg;
  bindFunctions?.(host);
  return host.innerHTML;
}

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

function MermaidBlock(props: { code: string }) {
  const [svg, setSvg] = createSignal<string>("");
  const [error, setError] = createSignal<string>("");
  let disposed = false;

  createEffect(() => {
    const source = props.code.trim();
    setSvg("");
    setError("");
    if (!source) {
      return;
    }
    void renderMermaidDiagram(source)
      .then((output) => {
        if (!disposed) {
          setSvg(output);
        }
      })
      .catch((cause: unknown) => {
        if (!disposed) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });
  });

  onCleanup(() => {
    disposed = true;
  });

  return (
    <div class="my-4 overflow-x-auto">
      <Show
        when={svg()}
        fallback={
          error() ? (
            <div class="space-y-3">
              <p class="text-xs font-medium uppercase tracking-wide text-muted">
                Mermaid render failed
              </p>
              <pre class="overflow-x-auto rounded-lg border border-border bg-[var(--vscode-editor-background)] p-3 text-[12px] leading-relaxed text-[var(--vscode-editor-foreground)]">
                <code>{props.code}</code>
              </pre>
              <p class="text-xs text-danger">{error()}</p>
            </div>
          ) : (
            <p class="text-xs text-muted">Rendering Mermaid diagram…</p>
          )
        }
      >
        <div
          class="mermaid-diagram [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
          innerHTML={svg()}
        />
      </Show>
    </div>
  );
}

function MarkdownCode(props: {
  inline?: boolean;
  class?: string;
  node?: HastNode;
  children?: unknown;
}) {
  const language = () => hastLanguage(props.node);
  const text = () => hastText(props.node).replace(/\n$/, "");
  const isMermaid = () => !props.inline && language() === "mermaid";

  return isMermaid() ? (
    <MermaidBlock code={text()} />
  ) : props.inline ? (
    <code class={props.class}>{props.children as never}</code>
  ) : (
    <pre class={props.class}>
      <code class={props.class}>{props.children as never}</code>
    </pre>
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
      components={{ a: MarkdownLink, code: MarkdownCode }}
    >
      {props.children}
    </SolidMarkdown>
  );
}
