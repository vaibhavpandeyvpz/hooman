import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import {
  ArrowUp,
  Cpu,
  Folder,
  FileText,
  Image as ImageIcon,
  Paperclip,
  ToggleLeft,
  ToggleRight,
  X,
} from "lucide-solid";
import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import {
  addDataAttachment,
  clearEditDraft,
  openAttachment,
  pickFiles,
  removeAttachment,
  resolveDropped,
  setConfigOption,
  state,
  submitPrompt,
} from "../store";
import {
  CONFIG_ID_EFFORT,
  CONFIG_ID_MODE,
  CONFIG_ID_MODEL,
} from "../lib/config-ids";
import { effortMeta, modeMeta } from "../lib/meta";
import { flattenSelectOptions } from "../lib/config-options";
import Picker, { type PickerOption } from "./Picker";
import EffortGauge from "./EffortGauge";
import SlashPopup from "./SlashPopup";

/** Base64-encode dropped/pasted file bytes (chunked to stay under argument limits). */
function bytesToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function stageFileObject(file: File): Promise<void> {
  const base64 = bytesToBase64(await file.arrayBuffer());
  addDataAttachment(
    file.name || "attachment",
    file.type || "application/octet-stream",
    base64,
  );
}

/** `file://` URIs from a drop's uri-list payload (VS Code explorer drags carry these). */
function fileUrisFromDrop(dataTransfer: DataTransfer): string[] {
  const uriList =
    dataTransfer.getData("text/uri-list") ||
    dataTransfer.getData("application/vnd.code.uri-list");
  return uriList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 && !line.startsWith("#") && line.startsWith("file://"),
    );
}

export default function Composer() {
  const [text, setText] = createSignal("");
  const [slashIndex, setSlashIndex] = createSignal(0);
  const [dragging, setDragging] = createSignal(false);
  let textareaRef: HTMLTextAreaElement | undefined;

  const matchingCommands = createMemo(() => {
    const value = text();
    if (!value.startsWith("/") || value.includes("\n") || value.includes(" ")) {
      return [];
    }
    const needle = value.slice(1).toLowerCase();
    return state.commands.filter((cmd) =>
      cmd.name.toLowerCase().startsWith(needle),
    );
  });

  const selectOptions = createMemo(() =>
    state.configOptions.filter(
      (o): o is Extract<SessionConfigOption, { type: "select" }> =>
        o.type === "select",
    ),
  );
  const booleanOptions = createMemo(() =>
    state.configOptions.filter(
      (o): o is Extract<SessionConfigOption, { type: "boolean" }> =>
        o.type === "boolean",
    ),
  );

  function autoresize() {
    if (!textareaRef) {
      return;
    }
    textareaRef.style.height = "auto";
    textareaRef.style.height = `${Math.min(textareaRef.scrollHeight, 160)}px`;
  }

  // A queued item picked for editing lands here; load it into the composer
  // for the user to tweak and resubmit (it was already removed from the queue).
  createEffect(() => {
    const draft = state.editDraft;
    if (draft === null) {
      return;
    }
    setText(draft);
    clearEditDraft();
    queueMicrotask(() => {
      autoresize();
      textareaRef?.focus();
    });
  });

  function submit() {
    const value = text();
    if (!value.trim() && state.attachments.length === 0) {
      return;
    }
    // While busy this queues instead of starting a new turn immediately.
    submitPrompt(value);
    setText("");
    queueMicrotask(autoresize);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    const dataTransfer = event.dataTransfer;
    if (!dataTransfer) {
      return;
    }
    // Prefer path-backed URIs (VS Code explorer, some OS drags): the host can
    // stat them and send folders/files as resource links. Fall back to raw
    // File payloads (plain OS drops), where only the bytes are available.
    const uris = fileUrisFromDrop(dataTransfer);
    if (uris.length > 0) {
      resolveDropped(uris);
      return;
    }
    for (const file of Array.from(dataTransfer.files)) {
      void stageFileObject(file);
    }
  }

  function onPaste(event: ClipboardEvent) {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    for (const file of files) {
      void stageFileObject(file);
    }
  }

  function applySlashCommand(name: string) {
    setText(`/${name} `);
    textareaRef?.focus();
  }

  function onKeyDown(event: KeyboardEvent) {
    const matches = matchingCommands();
    if (matches.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSlashIndex((i) => (i + 1) % matches.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSlashIndex((i) => (i - 1 + matches.length) % matches.length);
        return;
      }
      if (event.key === "Tab" || event.key === "Enter") {
        event.preventDefault();
        applySlashCommand(
          matches[Math.min(slashIndex(), matches.length - 1)].name,
        );
        return;
      }
      if (event.key === "Escape") {
        setText("");
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  return (
    <div class="relative shrink-0 border-t border-border bg-background p-2.5 pt-2">
      <SlashPopup
        commands={matchingCommands()}
        activeIndex={Math.min(
          slashIndex(),
          Math.max(0, matchingCommands().length - 1),
        )}
        onSelect={(cmd) => applySlashCommand(cmd.name)}
      />
      <div
        class={`flex flex-col gap-2 rounded-2xl border bg-input px-3 py-2 focus-within:border-focus ${
          dragging() ? "border-focus" : "border-input-border"
        }`}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <Show when={state.attachments.length > 0}>
          <div class="flex flex-wrap gap-1">
            <For each={state.attachments}>
              {(attachment) => (
                <span class="flex max-w-full items-center gap-1 rounded-md border border-border bg-panel px-1.5 py-0.5 text-[11.5px] text-accent">
                  <button
                    type="button"
                    class="flex min-w-0 cursor-pointer items-center gap-1 hover:underline"
                    title={`Open ${attachment.path ?? attachment.name}`}
                    onClick={() => openAttachment(attachment)}
                  >
                    <Show
                      when={attachment.kind === "image"}
                      fallback={
                        <Show
                          when={attachment.kind === "directory"}
                          fallback={<FileText size={11} class="shrink-0" />}
                        >
                          <Folder size={11} class="shrink-0" />
                        </Show>
                      }
                    >
                      <ImageIcon size={11} class="shrink-0" />
                    </Show>
                    <span class="truncate">{attachment.name}</span>
                  </button>
                  <button
                    type="button"
                    class="shrink-0 rounded text-muted hover:text-foreground"
                    title="Remove attachment"
                    onClick={() => removeAttachment(attachment.id)}
                  >
                    <X size={11} />
                  </button>
                </span>
              )}
            </For>
          </div>
        </Show>
        <textarea
          ref={textareaRef}
          rows={1}
          placeholder={state.busy ? "Queue a follow-up…" : "Ask Hooman…"}
          class="max-h-40 min-h-[22px] w-full resize-none border-none bg-transparent text-[13px] leading-relaxed text-input-foreground outline-none placeholder:text-muted"
          value={text()}
          onInput={(event) => {
            setText(event.currentTarget.value);
            setSlashIndex(0);
            autoresize();
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
        <div class="flex items-center gap-1.5">
          <div class="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            <For each={selectOptions()}>
              {(option) => {
                const flat = flattenSelectOptions(option.options);
                const isMode = option.id === CONFIG_ID_MODE;
                const isEffort = option.id === CONFIG_ID_EFFORT;
                const isModel = option.id === CONFIG_ID_MODEL;

                const pickerOptions = (): PickerOption[] =>
                  flat.map((item) => {
                    if (isMode) {
                      const meta = modeMeta(item.value);
                      return {
                        value: item.value,
                        label: item.name,
                        icon: (
                          <Dynamic
                            component={meta.icon}
                            size={12}
                            class={meta.className}
                          />
                        ),
                      };
                    }
                    if (isEffort) {
                      const meta = effortMeta(item.value);
                      return {
                        value: item.value,
                        label: item.name,
                        icon: (
                          <EffortGauge
                            bars={meta.bars}
                            class={meta.className}
                          />
                        ),
                      };
                    }
                    return {
                      value: item.value,
                      label: item.name,
                      description: item.description ?? undefined,
                    };
                  });

                const triggerIcon = () => {
                  if (isMode) {
                    const meta = modeMeta(option.currentValue);
                    return <Dynamic component={meta.icon} size={12} />;
                  }
                  if (isEffort) {
                    const meta = effortMeta(option.currentValue);
                    return <EffortGauge bars={meta.bars} />;
                  }
                  if (isModel) {
                    return <Cpu size={12} />;
                  }
                  return undefined;
                };

                const triggerClass = () => {
                  if (isMode) return modeMeta(option.currentValue).className;
                  if (isEffort)
                    return effortMeta(option.currentValue).className;
                  return "";
                };

                const currentLabel = () =>
                  flat.find((item) => item.value === option.currentValue)
                    ?.name ?? option.currentValue;

                return (
                  <Picker
                    icon={triggerIcon()}
                    className={triggerClass()}
                    label={currentLabel()}
                    value={option.currentValue}
                    options={pickerOptions()}
                    title={option.description ?? option.name}
                    onSelect={(value) => setConfigOption(option.id, value)}
                  />
                );
              }}
            </For>
            <For each={booleanOptions()}>
              {(option) => (
                <button
                  type="button"
                  class="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11.5px] text-muted hover:bg-panel"
                  title={option.description ?? option.name}
                  onClick={() =>
                    setConfigOption(option.id, !option.currentValue, true)
                  }
                >
                  <Show
                    when={option.currentValue}
                    fallback={<ToggleLeft size={13} />}
                  >
                    <ToggleRight size={13} class="text-accent" />
                  </Show>
                  {option.name}
                </button>
              )}
            </For>
          </div>
          <button
            type="button"
            class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-panel hover:text-foreground"
            title="Attach files"
            onClick={() => pickFiles()}
          >
            <Paperclip size={14} />
          </button>
          <button
            type="button"
            class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-button text-button-foreground transition-colors hover:bg-button-hover disabled:opacity-40"
            disabled={!text().trim() && state.attachments.length === 0}
            title={state.busy ? "Queue (runs after the current turn)" : "Send"}
            onClick={submit}
          >
            <ArrowUp size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
