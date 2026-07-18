import { useCallback, useRef, useState } from "react";
import type {
  PromptContentBlock,
  SessionConfigOption,
  TranscriptState,
} from "../../shared/session-types.js";
import {
  ArrowUp,
  Cpu,
  Eye,
  EyeOff,
  FileText,
  Image as ImageIcon,
  Paperclip,
  Square,
  X,
} from "lucide-react";
import { cn } from "../lib/cn.js";
import {
  fileToAttachment,
  type ComposerAttachment,
} from "../lib/attachments.js";
import { Picker, type PickerOption } from "./Picker.js";
import { EffortGauge } from "./EffortGauge.js";
import { effortMeta, modeMeta } from "../lib/mode-meta.js";
import { UsageFooter } from "./UsageFooter.js";
import { BusyIndicator } from "./BusyIndicator.js";

export function Composer({
  state,
  disabled,
  sending,
  promptStartedAt,
  onSend,
  onCancel,
  onSetConfigOption,
}: {
  state: TranscriptState;
  disabled: boolean;
  sending: boolean;
  promptStartedAt: number | null;
  onSend: (prompt: PromptContentBlock[]) => void;
  onCancel: () => void;
  onSetConfigOption: (configId: string, value: string | boolean) => void;
}) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const addFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const staged = await Promise.all(files.map(fileToAttachment));
      setAttachments((prev) => [...prev, ...staged]);
    } finally {
      setUploading(false);
    }
  }, []);

  const removeAttachment = (id: string) =>
    setAttachments((prev) => prev.filter((a) => a.id !== id));

  const submit = useCallback(() => {
    if (disabled || uploading) return;
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    const blocks: PromptContentBlock[] = [];
    if (trimmed) blocks.push({ type: "text", text: trimmed });
    for (const attachment of attachments) blocks.push(attachment.block);
    onSend(blocks);
    setText("");
    setAttachments([]);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [disabled, uploading, text, attachments, onSend]);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      if (disabled) return;
      void addFiles(Array.from(event.dataTransfer.files));
    },
    [disabled, addFiles],
  );

  const onPaste = useCallback(
    (event: React.ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length === 0 || disabled) return;
      event.preventDefault();
      void addFiles(files);
    },
    [disabled, addFiles],
  );

  const autoresize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  const selectOptions = state.configOptions.filter(
    (o): o is Extract<SessionConfigOption, { type: "select" }> =>
      o.type === "select",
  );
  const booleanOptions = state.configOptions.filter(
    (o): o is Extract<SessionConfigOption, { type: "boolean" }> =>
      o.type === "boolean",
  );

  return (
    <div className="shrink-0 border-t border-slate-800 bg-slate-950 p-2.5 pt-2">
      <BusyIndicator busy={sending} startedAt={promptStartedAt} />
      <UsageFooter state={state} />
      <div
        className={cn(
          "flex flex-col gap-2 rounded-lg border bg-slate-900 px-3 py-2 focus-within:border-hooman-primary",
          dragging ? "border-hooman-primary" : "border-slate-800",
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {attachments.map((attachment) => (
              <span
                key={attachment.id}
                className="flex max-w-full items-center gap-1 rounded-md border border-slate-800 bg-slate-950 px-1.5 py-0.5 text-[11.5px]"
              >
                {attachment.kind === "image" ? (
                  <ImageIcon size={11} className="shrink-0" />
                ) : (
                  <FileText size={11} className="shrink-0" />
                )}
                <span className="truncate">{attachment.name}</span>
                <button
                  type="button"
                  className="shrink-0 text-hooman-muted hover:text-slate-100"
                  onClick={() => removeAttachment(attachment.id)}
                  aria-label="Remove attachment"
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          rows={1}
          placeholder={
            disabled
              ? "Starting session…"
              : sending
                ? "Queue a follow-up…"
                : "Ask Hooman…"
          }
          disabled={disabled}
          className="max-h-40 min-h-[22px] w-full resize-none border-none bg-transparent text-[13px] leading-relaxed text-slate-100 outline-none placeholder:text-hooman-muted disabled:cursor-not-allowed disabled:opacity-60"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            autoresize();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          onPaste={onPaste}
        />

        <div className="flex items-center gap-1.5">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              void addFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <button
            type="button"
            title="Add attachments"
            className="rounded-md p-1 text-hooman-muted hover:bg-slate-800 hover:text-slate-100"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
          >
            <Paperclip size={14} />
          </button>

          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            {selectOptions.map((option) => {
              const isMode = option.id === "mode";
              const isEffort = option.id === "effort";
              const pickerOptions: PickerOption[] = option.options.map(
                (item) => {
                  if (isMode) {
                    const meta = modeMeta(item.value);
                    const Icon = meta.icon;
                    return {
                      value: item.value,
                      label: item.name,
                      icon: <Icon size={12} className={meta.className} />,
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
                          className={meta.className}
                        />
                      ),
                    };
                  }
                  return {
                    value: item.value,
                    label: item.name,
                    description: item.description,
                  };
                },
              );
              const currentLabel =
                option.options.find(
                  (item) => item.value === option.currentValue,
                )?.name ?? option.currentValue;
              const triggerIcon = isMode ? (
                (() => {
                  const Icon = modeMeta(option.currentValue).icon;
                  return <Icon size={12} />;
                })()
              ) : isEffort ? (
                <EffortGauge bars={effortMeta(option.currentValue).bars} />
              ) : option.id === "model" ? (
                <Cpu size={12} />
              ) : undefined;
              const triggerClassName = isMode
                ? modeMeta(option.currentValue).className
                : isEffort
                  ? effortMeta(option.currentValue).className
                  : undefined;
              return (
                <Picker
                  key={option.id}
                  icon={triggerIcon}
                  className={triggerClassName}
                  label={currentLabel}
                  value={option.currentValue}
                  options={pickerOptions}
                  title={option.description ?? option.name}
                  disabled={disabled}
                  onSelect={(value) => onSetConfigOption(option.id, value)}
                />
              );
            })}
            {booleanOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                title={option.description ?? option.name}
                disabled={disabled}
                className={cn(
                  "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] disabled:opacity-50",
                  option.currentValue
                    ? "border-hooman-warning/40 bg-hooman-warning/10 text-hooman-warning"
                    : "border-slate-800 text-hooman-muted hover:bg-slate-800",
                )}
                onClick={() =>
                  onSetConfigOption(option.id, !option.currentValue)
                }
              >
                {option.currentValue ? <Eye size={12} /> : <EyeOff size={12} />}
                {option.name}
              </button>
            ))}
          </div>

          {sending ? (
            <button
              type="button"
              title="Stop"
              className="flex size-7 shrink-0 items-center justify-center rounded-md bg-slate-800 text-slate-100 hover:bg-slate-700"
              onClick={onCancel}
            >
              <Square size={13} />
            </button>
          ) : (
            <button
              type="button"
              title="Send"
              disabled={
                disabled ||
                uploading ||
                (!text.trim() && attachments.length === 0)
              }
              className="flex size-7 shrink-0 items-center justify-center rounded-md bg-hooman-primary text-white hover:bg-hooman-secondary disabled:opacity-40"
              onClick={submit}
            >
              <ArrowUp size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
