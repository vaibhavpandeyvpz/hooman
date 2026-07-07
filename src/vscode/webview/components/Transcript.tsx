import { createEffect, For, Match, Show, Switch } from "solid-js";
import { CircleAlert } from "lucide-solid";
import { latestCompletedAssistantId, sessionState } from "../store";
import EmptyState from "./EmptyState";
import UserMessage from "./UserMessage";
import AssistantMessage from "./AssistantMessage";
import ThoughtBlock from "./ThoughtBlock";
import ToolCard from "./ToolCard";
import PermissionCard from "./PermissionCard";
import RetryCard from "./RetryCard";

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
    const items = sessionState().items;
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
      <Show when={sessionState().items.length === 0}>
        <EmptyState />
      </Show>
      <For each={sessionState().items}>
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
              {(assistant) => (
                <AssistantMessage
                  id={assistant().id}
                  text={assistant().text}
                  copied={assistant().copied}
                  showActions={
                    !sessionState().busy &&
                    latestCompletedAssistantId() === assistant().id
                  }
                />
              )}
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
            <Match when={item.kind === "retry" && item}>
              {(retry) => (
                <RetryCard
                  retryInSeconds={retry().retryInSeconds}
                  attempt={retry().attempt}
                  maxAttempts={retry().maxAttempts}
                  error={retry().error}
                  errorDetail={retry().errorDetail}
                />
              )}
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
