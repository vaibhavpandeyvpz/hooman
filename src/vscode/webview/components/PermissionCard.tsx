import { For, Show } from "solid-js";
import { MessageCircleQuestion, ShieldAlert } from "lucide-solid";
import type { TranscriptItem } from "../store";
import { respondToPermission } from "../store";

export default function PermissionCard(props: {
  item: Extract<TranscriptItem, { kind: "permission" }>;
}) {
  const isQuestion = () => props.item.question === true;
  return (
    <Show
      when={!props.item.resolvedNote}
      fallback={
        <div class="self-center text-[11.5px] text-muted">
          {props.item.resolvedNote}
        </div>
      }
    >
      <div
        class={
          isQuestion()
            ? "self-stretch rounded-md border border-focus/50 bg-focus/10 px-3 py-2.5"
            : "self-stretch rounded-md border border-warning/50 bg-warning/10 px-3 py-2.5"
        }
      >
        <div class="flex items-center gap-1.5 font-medium">
          <Show
            when={isQuestion()}
            fallback={<ShieldAlert size={14} class="text-warning" />}
          >
            <MessageCircleQuestion size={14} class="text-focus" />
          </Show>
          {props.item.title}
        </div>
        <Show when={props.item.detail}>
          <div class="mt-1 max-h-36 overflow-y-auto whitespace-pre-wrap text-[12px] text-muted scroll-thin">
            {props.item.detail}
          </div>
        </Show>
        <div
          class={
            isQuestion()
              ? "mt-2 flex flex-col items-stretch gap-1.5"
              : "mt-2 flex flex-wrap gap-1.5"
          }
        >
          <For each={props.item.options}>
            {(option) => (
              <button
                type="button"
                class={`${
                  option.kind?.startsWith("allow")
                    ? "rounded-md bg-button px-2.5 py-1 text-[12px] text-button-foreground hover:bg-button-hover"
                    : "rounded-md border border-button-border bg-button-secondary px-2.5 py-1 text-[12px] text-button-secondary-foreground hover:bg-button-secondary-hover"
                }${isQuestion() ? " text-left" : ""}`}
                onClick={() =>
                  respondToPermission(
                    props.item.id,
                    option.optionId,
                    option.name,
                  )
                }
              >
                {option.name}
              </button>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}
