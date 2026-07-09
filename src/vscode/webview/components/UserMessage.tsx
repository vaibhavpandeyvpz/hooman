import { For, Show } from "solid-js";
import { Folder, FileText, Image as ImageIcon, Undo2 } from "lucide-solid";
import type { AttachmentInfo } from "../../src/shared/protocol";
import { openAttachment, revertTurn } from "../store";

export default function UserMessage(props: {
  text: string;
  attachments?: AttachmentInfo[];
  /** This turn's ACP `messageId` (agent-generated, per the MessageId RFD); undefined for replayed/historical turns. */
  messageId?: string;
  /** Whether reverting is currently allowed (hidden while the session is busy). */
  canRevert?: boolean;
}) {
  return (
    <div class="flex w-full flex-col items-end">
      <div class="max-w-[92%] rounded-xl border border-border bg-input px-3.5 py-2 text-[13px] leading-relaxed">
        <Show when={props.text}>
          <div class="whitespace-pre-wrap break-words">{props.text}</div>
        </Show>
        <Show when={props.attachments?.length}>
          <div class={`flex flex-wrap gap-1 ${props.text ? "mt-1.5" : ""}`}>
            <For each={props.attachments}>
              {(attachment) => (
                <button
                  type="button"
                  class="flex max-w-full cursor-pointer items-center gap-1 rounded-md border border-border bg-panel px-1.5 py-0.5 text-[11.5px] text-accent hover:border-focus hover:underline"
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
              )}
            </For>
          </div>
        </Show>
      </div>
      {props.messageId && props.canRevert ? (
        <div class="mt-1 flex items-center justify-end gap-0.5">
          <button
            type="button"
            class="rounded p-1 text-muted hover:bg-panel hover:text-foreground"
            title="Revert to before this message: undoes file changes made from here on and returns the message to the composer"
            aria-label="Revert to before this message"
            onClick={() => revertTurn(props.messageId!)}
          >
            <Undo2 size={12} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
