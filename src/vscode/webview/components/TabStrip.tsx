import { createEffect, For, Show } from "solid-js";
import { Loader2, X } from "lucide-solid";
import { activateTab, closeTab, state } from "../store";

export default function TabStrip() {
  let scroller: HTMLDivElement | undefined;
  const tabRefs = new Map<string, HTMLButtonElement>();

  createEffect(() => {
    const activeSessionId = state.activeSessionId;
    state.tabs.length;
    queueMicrotask(() => {
      if (!activeSessionId) return;
      const tab = tabRefs.get(activeSessionId);
      tab?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
        inline: "nearest",
      });
    });
  });

  return (
    <div class="flex shrink-0 items-stretch border-y border-[var(--vscode-editorGroupHeader-tabsBorder,var(--vscode-panel-border,var(--vscode-widget-border,transparent)))] bg-[var(--vscode-editorGroupHeader-tabsBackground,var(--vscode-sideBar-background))]">
      <div
        ref={scroller}
        class="scroll-thin min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
      >
        <div class="flex min-w-max">
          <For each={state.tabs}>
            {(tab) => {
              const active = () => state.activeSessionId === tab.sessionId;
              return (
                <button
                  ref={(el) => tabRefs.set(tab.sessionId, el)}
                  type="button"
                  class={`group relative flex h-9 min-w-32 max-w-64 shrink-0 items-center gap-1.5 border-r border-[var(--vscode-editorGroupHeader-tabsBorder,var(--vscode-panel-border,var(--vscode-widget-border,transparent)))] px-3 text-[12px] ${
                    active()
                      ? "bg-[var(--vscode-tab-activeBackground,var(--vscode-editor-background))] text-[var(--vscode-tab-activeForeground,var(--vscode-foreground))]"
                      : "bg-[var(--vscode-tab-inactiveBackground,var(--vscode-editorGroupHeader-tabsBackground,var(--vscode-sideBar-background)))] text-[var(--vscode-tab-inactiveForeground,var(--vscode-descriptionForeground))] hover:bg-[var(--vscode-tab-hoverBackground,var(--vscode-list-hoverBackground,var(--vscode-tab-inactiveBackground,var(--vscode-editorGroupHeader-tabsBackground,var(--vscode-sideBar-background)))))] hover:text-[var(--vscode-tab-hoverForeground,var(--vscode-foreground))]"
                  }`}
                  title={tab.title}
                  onClick={() => activateTab(tab.sessionId)}
                >
                  <Show when={active()}>
                    <span class="absolute inset-x-0 top-0 h-px bg-[var(--vscode-tab-activeBorderTop,var(--vscode-tab-activeBorder,var(--vscode-focusBorder)))]" />
                  </Show>
                  <Show when={tab.busy || tab.loading}>
                    <Loader2
                      size={11}
                      class="shrink-0 animate-spin text-[var(--vscode-tab-activeBorder,var(--vscode-textLink-foreground))]"
                    />
                  </Show>
                  <span class="min-w-0 flex-1 truncate text-left leading-none">
                    {tab.title}
                  </span>
                  <Show when={tab.unread}>
                    <span
                      class="h-2 w-2 shrink-0 rounded-full bg-[var(--vscode-tab-unfocusedActiveBorder,var(--vscode-tab-activeBorder,var(--vscode-textLink-foreground)))]"
                      title="Unread background activity"
                    />
                  </Show>
                  <Show when={(tab.pendingPermissions ?? 0) > 0}>
                    <span
                      class="shrink-0 rounded-sm bg-warning px-1 py-0.5 text-[10px] font-medium leading-none text-black"
                      title={`${tab.pendingPermissions} pending permission prompt${(tab.pendingPermissions ?? 0) === 1 ? "" : "s"}`}
                    >
                      {tab.pendingPermissions}
                    </span>
                  </Show>
                  <span
                    class="shrink-0 rounded-sm p-0.5 text-inherit opacity-70 hover:bg-[var(--vscode-toolbar-hoverBackground,var(--vscode-list-hoverBackground,transparent))] hover:opacity-100"
                    onClick={(event) => {
                      event.stopPropagation();
                      closeTab(tab.sessionId);
                    }}
                  >
                    <X size={11} />
                  </span>
                </button>
              );
            }}
          </For>
        </div>
      </div>
    </div>
  );
}
