import { Markdown } from "../lib/markdown";

export default function AssistantMessage(props: { text: string }) {
  return (
    <Markdown class="self-stretch break-words px-0.5 text-[13px] leading-relaxed">
      {props.text}
    </Markdown>
  );
}
