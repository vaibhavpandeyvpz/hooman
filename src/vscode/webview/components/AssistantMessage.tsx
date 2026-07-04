import { createMemo } from "solid-js";
import { renderMarkdown } from "../lib/markdown";

export default function AssistantMessage(props: { text: string }) {
  const html = createMemo(() => renderMarkdown(props.text));
  return (
    <div
      class="markdown-body self-stretch break-words px-0.5 text-[13px] leading-relaxed"
      innerHTML={html()}
    />
  );
}
