import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useState, useRef, useEffect } from "react";
import {
  useFloating,
  offset,
  flip,
  shift,
  size,
  autoUpdate,
} from "@floating-ui/react-dom";
import {
  FileText,
  ShieldCheck,
  Check,
  Infinity,
  X,
  ChevronDown,
} from "lucide-react";
import type { ChatMessage as ChatMessageType } from "../types";
import { getAttachmentSignedUrls } from "../api";

/** Detect approval card from structure (backend sends approvalRequest). */
export function isApprovalCard(message: ChatMessageType): boolean {
  return message.role === "assistant" && !!message.approvalRequest;
}

/** Match backend confirmation parsing: y/yes/ok, always, n/no. */
export function isApprovalReply(
  text: string,
): "confirm" | "allow_every_time" | "reject" | null {
  const t = (text ?? "").trim().toLowerCase();
  if (!t) return null;
  if (/^(y|yes|ok)$/.test(t)) return "confirm";
  if (/^(always|allow\s+always|allow\s+every\s*time)$/.test(t))
    return "allow_every_time";
  if (/^(n|no)$/.test(t)) return "reject";
  return null;
}

function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

/** Renders a non-image attachment link using a signed URL (open in new tab without auth). */
function SignedAttachmentLink({
  id,
  originalName,
}: {
  id: string;
  originalName: string;
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  useEffect(() => {
    getAttachmentSignedUrls([id])
      .then((urls) => {
        const u = urls.find((x) => x.id === id);
        if (u?.url) setSignedUrl(u.url);
      })
      .catch(() => {});
  }, [id]);
  if (!signedUrl) {
    return (
      <span className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-hooman-muted bg-hooman-border/50 rounded-lg">
        <FileText className="w-4 h-4 shrink-0" />
        <span className="truncate">{originalName}</span>
      </span>
    );
  }
  return (
    <a
      href={signedUrl}
      target="_blank"
      rel="noopener noreferrer"
      download={originalName}
      className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-zinc-300 hover:text-hooman-cyan transition-colors"
    >
      <FileText className="w-4 h-4 shrink-0" />
      <span className="truncate">{originalName}</span>
    </a>
  );
}

/** Renders an image attachment using a signed URL (loads in bubble and opens in new tab without auth). */
function SignedImage({
  id,
  originalName,
  className,
}: {
  id: string;
  originalName: string;
  className?: string;
}) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  useEffect(() => {
    getAttachmentSignedUrls([id])
      .then((urls) => {
        const u = urls.find((x) => x.id === id);
        if (u?.url) setSignedUrl(u.url);
      })
      .catch(() => {});
  }, [id]);
  if (!signedUrl) {
    return (
      <span className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-hooman-muted bg-hooman-border/50 rounded-lg">
        <FileText className="w-4 h-4 shrink-0" />
        <span className="truncate">{originalName}</span>
      </span>
    );
  }
  return (
    <a
      href={signedUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="block"
    >
      <img src={signedUrl} alt={originalName} className={className} />
    </a>
  );
}

function formatMessageTime(iso?: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/** Split button: main = Allow once, dropdown = Allow every time. Uses Floating UI for positioning. */
function ApprovalSplitButton({
  disabled,
  onAllowOnce,
  onAllowEveryTime,
}: {
  disabled: boolean;
  onAllowOnce: () => void;
  onAllowEveryTime: () => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { refs, floatingStyles } = useFloating({
    placement: "bottom-start",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(4),
      flip(),
      shift({ padding: 8 }),
      size({
        apply({ rects, elements }) {
          Object.assign(elements.floating.style, {
            minWidth: `${rects.reference.width}px`,
          });
        },
      }),
    ],
  });

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-flex shrink-0">
      <div
        ref={refs.setReference}
        className="inline-flex rounded-lg overflow-hidden border border-transparent bg-hooman-accent/90 focus-within:ring-2 focus-within:ring-hooman-accent focus-within:ring-offset-2 focus-within:ring-offset-hooman-surface"
      >
        <button
          type="button"
          disabled={disabled}
          onClick={onAllowOnce}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white hover:bg-hooman-accent disabled:opacity-50 transition-colors"
        >
          <Check className="w-3.5 h-3.5" />
          Allow once
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-haspopup="true"
          className="inline-flex items-center px-1.5 py-1.5 border-l border-white/30 text-white hover:bg-hooman-accent disabled:opacity-50 transition-colors"
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>
      {open && (
        <div
          ref={refs.setFloating}
          style={floatingStyles}
          className="z-50 rounded-lg border border-hooman-border bg-hooman-surface shadow-lg py-0.5 w-max"
        >
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              onAllowEveryTime();
              setOpen(false);
            }}
            className="w-full inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-200 hover:bg-hooman-border/30 disabled:opacity-50 transition-colors text-left whitespace-nowrap"
          >
            <Infinity className="w-3.5 h-3.5 shrink-0" />
            Allow every time
          </button>
        </div>
      )}
    </div>
  );
}

export function ChatMessage({
  message: m,
  onApprovalReply,
  approvalReplySending = false,
  resolvedState = null,
}: {
  message: ChatMessageType;
  onApprovalReply?: (text: string) => void;
  approvalReplySending?: boolean;
  /** When the next message was an approval reply (y/n/always), show resolved state and hide action buttons. */
  resolvedState?: "confirm" | "allow_every_time" | "reject" | null;
}) {
  const timeStr = formatMessageTime(m.timestamp);
  const approval = m.role === "assistant" ? (m.approvalRequest ?? null) : null;
  const showApprovalCard = approval && m.role === "assistant";
  const showApprovalButtons =
    showApprovalCard && onApprovalReply && !resolvedState;

  return (
    <div
      className={`flex flex-col animate-fade-in-up ${m.role === "user" ? "items-end" : "items-start"}`}
    >
      <div
        className={`flex ${m.role === "user" ? "justify-end" : "justify-start"} max-w-[85%] sm:max-w-[80%]`}
      >
        <div
          className={`rounded-2xl px-3 md:px-4 py-2.5 md:py-3 text-sm shadow-card ${
            m.role === "user"
              ? "bg-gradient-accent-subtle border border-hooman-accent/25 text-white"
              : "bg-hooman-surface border border-hooman-border/80 text-zinc-200"
          }`}
        >
          {showApprovalCard ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-hooman-cyan flex-wrap">
                <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden />
                <span className="font-medium">Tool approval</span>
                {resolvedState && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${
                      resolvedState === "reject"
                        ? "bg-red-500/20 text-red-300"
                        : "bg-green-500/20 text-green-300"
                    }`}
                  >
                    {resolvedState === "reject" ? (
                      <>
                        <X className="w-3 h-3" />
                        Rejected
                      </>
                    ) : resolvedState === "allow_every_time" ? (
                      <>
                        <Infinity className="w-3 h-3" />
                        Allow every time
                      </>
                    ) : (
                      <>
                        <Check className="w-3 h-3" />
                        Approved
                      </>
                    )}
                  </span>
                )}
              </div>
              <div className="space-y-1 text-zinc-300">
                <p className="flex flex-wrap items-baseline gap-1.5">
                  <span className="text-hooman-muted">Tool:</span>
                  <code className="text-xs bg-hooman-border/60 px-1.5 py-0.5 rounded text-hooman-cyan">
                    {approval!.toolName}
                  </code>
                </p>
                {approval!.argsPreview && (
                  <p className="flex flex-wrap items-baseline gap-1.5">
                    <span className="text-hooman-muted">Arguments:</span>
                    <code className="text-xs bg-hooman-border/60 px-1.5 py-0.5 rounded break-all">
                      {approval!.argsPreview}
                    </code>
                  </p>
                )}
              </div>
              {showApprovalButtons && (
                <div className="flex flex-nowrap gap-2 pt-1 items-center">
                  <ApprovalSplitButton
                    disabled={approvalReplySending}
                    onAllowOnce={() => onApprovalReply!("y")}
                    onAllowEveryTime={() => onApprovalReply!("always")}
                  />
                  <button
                    type="button"
                    disabled={approvalReplySending}
                    onClick={() => onApprovalReply!("n")}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/20 disabled:opacity-50 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                    Reject
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="chat-markdown prose prose-invert prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-headings:my-2 prose-a:text-hooman-accent-bright prose-a:no-underline hover:prose-a:underline prose-strong:text-inherit prose-code:bg-hooman-border/60 prose-code:px-1.5 prose-code:rounded-lg prose-code:before:content-none prose-code:after:content-none prose-code:text-hooman-cyan">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {m.text}
              </ReactMarkdown>
            </div>
          )}
          {(m.attachment_metas?.length ?? 0) > 0 && (
            <div className="mt-2 flex flex-wrap gap-2 border-t border-white/10 pt-2">
              {m.attachment_metas!.map((att) => (
                <div
                  key={att.id}
                  className="rounded-xl overflow-hidden bg-black/20 max-w-[120px] border border-hooman-border/50"
                >
                  {isImageMime(att.mimeType) ? (
                    <SignedImage
                      id={att.id}
                      originalName={att.originalName}
                      className="w-full h-20 object-cover"
                    />
                  ) : (
                    <SignedAttachmentLink
                      id={att.id}
                      originalName={att.originalName}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {timeStr && (
        <span
          className={`mt-1 text-xs text-hooman-muted ${
            m.role === "user" ? "pr-1" : "pl-1"
          }`}
        >
          {timeStr}
        </span>
      )}
    </div>
  );
}
