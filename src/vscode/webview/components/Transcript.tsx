import { createEffect, For, Match, Show, Switch } from "solid-js";
import { CircleAlert } from "lucide-solid";
import { state } from "../store";
import EmptyState from "./EmptyState";
import UserMessage from "./UserMessage";
import AssistantMessage from "./AssistantMessage";
import ThoughtBlock from "./ThoughtBlock";
import ToolCard from "./ToolCard";
import PermissionCard from "./PermissionCard";

export default function Transcript() {
  let containerRef: HTMLDivElement | undefined;

  const isNearBottom = () => {
    if (!containerRef) {
      return true;
    }
    return (
      containerRef.scrollHeight -
        containerRef.scrollTop -
        containerRef.clientHeight <
      60
    );
  };

  // Stick to the bottom only when the user is already there, so streaming
  // updates (assistant text, live terminal output) don't fight manual
  // scrollback.
  createEffect(() => {
    const items = state.items;
    const last = items[items.length - 1];
    // Read whichever field can grow during streaming so this effect re-runs on it.
    void (last?.kind === "assistant" || last?.kind === "thought"
      ? last.text
      : items.length);
    if (containerRef && isNearBottom()) {
      containerRef.scrollTop = containerRef.scrollHeight;
    }
  });

  return (
    <div
      ref={containerRef}
      class="scroll-thin flex flex-1 flex-col gap-2 overflow-y-auto p-2.5"
    >
      <Show when={state.items.length === 0}>
        <EmptyState />
      </Show>
      <For each={state.items}>
        {(item) => (
          <Switch>
            <Match when={item.kind === "user" && item}>
              {(user) => (
                <UserMessage
                  text={user().text}
                  attachments={user().attachments}
                />
              )}
            </Match>
            <Match when={item.kind === "assistant" && item}>
              {(assistant) => <AssistantMessage text={assistant().text} />}
            </Match>
            <Match when={item.kind === "thought" && item}>
              {(thought) => (
                <ThoughtBlock
                  text={thought().text}
                  startedAt={thought().startedAt}
                  finishedAt={thought().finishedAt}
                />
              )}
            </Match>
            <Match when={item.kind === "tool" && item}>
              {(tool) => <ToolCard item={tool()} />}
            </Match>
            <Match when={item.kind === "permission" && item}>
              {(perm) => <PermissionCard item={perm()} />}
            </Match>
            <Match when={item.kind === "error" && item}>
              {(error) => (
                <div class="flex items-center gap-1.5 self-stretch rounded-md border border-error/50 px-2.5 py-1.5 text-[12.5px] text-error">
                  <CircleAlert size={14} />
                  {error().message}
                </div>
              )}
            </Match>
          </Switch>
        )}
      </For>
    </div>
  );
}
