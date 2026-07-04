import { For, Show } from "solid-js";
import type { CommandInfo } from "../../src/shared/protocol";

export default function SlashPopup(props: {
  commands: CommandInfo[];
  activeIndex: number;
  onSelect: (command: CommandInfo) => void;
}) {
  return (
    <Show when={props.commands.length > 0}>
      <div class="absolute bottom-full left-2.5 right-2.5 z-10 mb-1 max-h-44 overflow-y-auto rounded-md border border-border bg-panel py-1 shadow-lg scroll-thin">
        <For each={props.commands}>
          {(command, index) => (
            <div
              class={`flex cursor-pointer items-baseline gap-2 px-2.5 py-1 ${
                index() === props.activeIndex
                  ? "bg-list-active-bg text-list-active-fg"
                  : ""
              }`}
              onMouseDown={(event) => {
                event.preventDefault();
                props.onSelect(command);
              }}
            >
              <span class="font-mono text-[12px] font-medium">
                /{command.name}
              </span>
              <Show when={command.description}>
                <span class="min-w-0 flex-1 truncate text-[11.5px] text-muted">
                  {command.description}
                </span>
              </Show>
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}
