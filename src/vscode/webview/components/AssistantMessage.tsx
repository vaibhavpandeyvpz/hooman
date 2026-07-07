import { Copy, GitFork, Check } from "lucide-solid";
import { forkChatFromPanel, setAssistantCopied } from "../store";
import { Markdown } from "../lib/markdown";

function fallbackCopyText(text: string): boolean {
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "true");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  } catch {
    return false;
  }
}

export default function AssistantMessage(props: {
  id: string;
  text: string;
  copied?: boolean;
  showActions?: boolean;
}) {
  const copyResponse = async () => {
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(props.text);
        copied = true;
      } else {
        copied = fallbackCopyText(props.text);
      }
    } catch {
      copied = fallbackCopyText(props.text);
    }
    if (!copied) {
      return;
    }
    setAssistantCopied(props.id, true);
    window.setTimeout(() => setAssistantCopied(props.id, false), 1200);
  };

  return (
    <div class="group self-stretch">
      <Markdown class="self-stretch break-words px-0.5 text-[13px] leading-relaxed">
        {props.text}
      </Markdown>
      {props.showActions ? (
        <div class="mt-1 flex items-center justify-end gap-0.5 opacity-100">
          <button
            type="button"
            class="rounded p-1 text-muted hover:bg-panel hover:text-foreground"
            title={props.copied ? "Copied" : "Copy message markdown"}
            aria-label={props.copied ? "Copied" : "Copy message markdown"}
            onClick={() => {
              void copyResponse();
            }}
          >
            {props.copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
          <button
            type="button"
            class="rounded p-1 text-muted hover:bg-panel hover:text-foreground"
            title="Fork chat"
            aria-label="Fork chat"
            onClick={() => forkChatFromPanel()}
          >
            <GitFork size={12} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
