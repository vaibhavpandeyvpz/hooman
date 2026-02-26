import { useState, useEffect, useCallback } from "react";
import {
  RefreshCw,
  MessageSquare,
  Send,
  Wrench,
  CircleCheck,
  CalendarClock,
  Shield,
  Brain,
  AlertTriangle,
  Zap,
  Code,
} from "lucide-react";
import type { AuditEntry } from "../types";
import { getAudit } from "../api";
import { getSocket } from "../socket";
import { Button } from "./Button";
import { PageHeader } from "./PageHeader";

function formatRelative(timestamp: string): string {
  const d = new Date(timestamp);
  const now = new Date();
  const sec = Math.floor((now.getTime() - d.getTime()) / 1000);
  if (sec < 60) return "Just now";
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} hr ago`;
  if (sec < 604800) return `${Math.floor(sec / 86400)} days ago`;
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

function formatFullTime(timestamp: string): string {
  return new Date(timestamp).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  });
}

function PayloadRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="flex gap-2 text-xs">
      <span className="text-hooman-muted shrink-0">{label}:</span>
      <span
        className={
          mono
            ? "font-mono text-zinc-300 break-all"
            : "text-zinc-300 break-words"
        }
      >
        {typeof value === "object" ? JSON.stringify(value) : String(value)}
      </span>
    </div>
  );
}

function AuditEntryCard({
  entry,
  showRaw,
  onToggleRaw,
}: {
  entry: AuditEntry;
  showRaw: boolean;
  onToggleRaw: () => void;
}) {
  const p = entry.payload as Record<string, unknown>;
  const time = formatRelative(entry.timestamp);
  const fullTime = formatFullTime(entry.timestamp);

  const [expanded, setExpanded] = useState(false);

  switch (entry.type) {
    case "incoming_message": {
      const source = p.source as string | undefined;
      const channel = p.channel as string | undefined;
      return (
        <article
          className="rounded-xl border border-hooman-border bg-hooman-surface overflow-hidden"
          aria-label={`Message received ${time}`}
        >
          <div className="flex items-start gap-3 px-4 py-3">
            <div className="rounded-lg bg-blue-500/15 p-2 shrink-0">
              <MessageSquare className="w-4 h-4 text-blue-400" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-medium text-white">
                  Message received
                </h3>
                <time title={fullTime} className="text-xs text-hooman-muted">
                  {time}
                </time>
              </div>
              <p className="mt-1 text-sm text-zinc-300 whitespace-pre-wrap break-words">
                {(p.textPreview as string) || "(no preview)"}
              </p>
              <div className="mt-2 space-y-0.5">
                <PayloadRow label="From" value={p.userId as string} />
                <PayloadRow
                  label="Channel"
                  value={channel ?? (source as string)}
                />
                {p.sourceMessageType && (
                  <PayloadRow
                    label="Type"
                    value={p.sourceMessageType as string}
                  />
                )}
              </div>
            </div>
          </div>
          {showRaw && (
            <pre className="px-4 pb-3 pt-0 text-xs text-zinc-500 font-mono overflow-x-auto whitespace-pre-wrap border-t border-hooman-border/50 mt-2 pt-2">
              {JSON.stringify(entry.payload, null, 2)}
            </pre>
          )}
          <button
            type="button"
            onClick={onToggleRaw}
            className="w-full px-4 py-1.5 flex items-center justify-center gap-1 text-xs text-hooman-muted hover:text-zinc-400 hover:bg-hooman-border/20 transition-colors"
          >
            <Code className="w-3.5 h-3.5" />
            {showRaw ? "Hide" : "Show"} raw data
          </button>
        </article>
      );
    }

    case "decision": {
      const subType = p.type as string | undefined;
      const isResponse = subType === "response";
      const isCapability = subType === "capability_request";
      const text = p.text as string | undefined;
      const decision = p.decision as
        | { type?: string; reasoning?: string }
        | undefined;
      const integration = p.integration as string | undefined;
      const capability = p.capability as string | undefined;
      const reason = p.reason as string | undefined;
      return (
        <article
          className="rounded-xl border border-hooman-border bg-hooman-surface overflow-hidden"
          aria-label={`Decision ${time}`}
        >
          <div className="flex items-start gap-3 px-4 py-3">
            <div className="rounded-lg bg-emerald-500/15 p-2 shrink-0">
              <Send className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-medium text-white">
                  {isResponse
                    ? "Hooman replied"
                    : isCapability
                      ? "Capability requested"
                      : "Decision"}
                </h3>
                <time title={fullTime} className="text-xs text-hooman-muted">
                  {time}
                </time>
              </div>
              {isResponse && text && (
                <p
                  className={`mt-1 text-sm text-zinc-300 whitespace-pre-wrap break-words ${expanded ? "" : "line-clamp-3"}`}
                >
                  {text}
                </p>
              )}
              {isResponse && text && text.length > 150 && (
                <button
                  type="button"
                  onClick={() => setExpanded((e) => !e)}
                  className="text-xs text-hooman-accent hover:underline mt-0.5"
                >
                  {expanded ? "Show less" : "Show more"}
                </button>
              )}
              {decision?.reasoning && (
                <p className="mt-1 text-xs text-hooman-muted italic">
                  {String(decision.reasoning).slice(0, 200)}
                  {(decision.reasoning as string).length > 200 ? "…" : ""}
                </p>
              )}
              {isCapability && (
                <div className="mt-2 space-y-0.5">
                  <PayloadRow label="Integration" value={integration} />
                  <PayloadRow label="Capability" value={capability} />
                  <PayloadRow label="Reason" value={reason} />
                </div>
              )}
              {!isResponse && !isCapability && decision?.type && (
                <PayloadRow label="Type" value={decision.type} />
              )}
            </div>
          </div>
          {showRaw && (
            <pre className="px-4 pb-3 pt-0 text-xs text-zinc-500 font-mono overflow-x-auto whitespace-pre-wrap border-t border-hooman-border/50 mt-2 pt-2">
              {JSON.stringify(entry.payload, null, 2)}
            </pre>
          )}
          <button
            type="button"
            onClick={onToggleRaw}
            className="w-full px-4 py-1.5 flex items-center justify-center gap-1 text-xs text-hooman-muted hover:text-zinc-400 hover:bg-hooman-border/20 transition-colors"
          >
            <Code className="w-3.5 h-3.5" />
            {showRaw ? "Hide" : "Show"} raw data
          </button>
        </article>
      );
    }

    case "tool_call_start":
      return (
        <article
          className="rounded-xl border border-hooman-border bg-hooman-surface overflow-hidden"
          aria-label={`Tool started ${time}`}
        >
          <div className="flex items-start gap-3 px-4 py-3">
            <div className="rounded-lg bg-amber-500/15 p-2 shrink-0">
              <Wrench className="w-4 h-4 text-amber-400" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-medium text-white">
                  Tool used: {(p.toolName as string) || "—"}
                </h3>
                <time title={fullTime} className="text-xs text-hooman-muted">
                  {time}
                </time>
              </div>
              {p.input !== undefined && (
                <div className="mt-1.5 font-mono text-xs text-zinc-400 bg-hooman-bg/60 rounded px-2 py-1.5 break-all">
                  {typeof p.input === "object"
                    ? JSON.stringify(p.input)
                    : String(p.input)}
                </div>
              )}
            </div>
          </div>
          {showRaw && (
            <pre className="px-4 pb-3 pt-0 text-xs text-zinc-500 font-mono overflow-x-auto whitespace-pre-wrap border-t border-hooman-border/50 mt-2 pt-2">
              {JSON.stringify(entry.payload, null, 2)}
            </pre>
          )}
          <button
            type="button"
            onClick={onToggleRaw}
            className="w-full px-4 py-1.5 flex items-center justify-center gap-1 text-xs text-hooman-muted hover:text-zinc-400 hover:bg-hooman-border/20 transition-colors"
          >
            <Code className="w-3.5 h-3.5" />
            {showRaw ? "Hide" : "Show"} raw data
          </button>
        </article>
      );

    case "tool_call_end":
      return (
        <article
          className="rounded-xl border border-hooman-border bg-hooman-surface overflow-hidden"
          aria-label={`Tool finished ${time}`}
        >
          <div className="flex items-start gap-3 px-4 py-3">
            <div className="rounded-lg bg-amber-500/10 p-2 shrink-0">
              <Wrench className="w-4 h-4 text-amber-500/80" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-medium text-white">
                  Tool result: {(p.toolName as string) || "—"}
                </h3>
                <time title={fullTime} className="text-xs text-hooman-muted">
                  {time}
                </time>
              </div>
              {p.result !== undefined && (
                <div className="mt-1.5 font-mono text-xs text-zinc-400 bg-hooman-bg/60 rounded px-2 py-1.5 break-all max-h-24 overflow-y-auto">
                  {typeof p.result === "object"
                    ? JSON.stringify(p.result)
                    : String(p.result)}
                </div>
              )}
            </div>
          </div>
          {showRaw && (
            <pre className="px-4 pb-3 pt-0 text-xs text-zinc-500 font-mono overflow-x-auto whitespace-pre-wrap border-t border-hooman-border/50 mt-2 pt-2">
              {JSON.stringify(entry.payload, null, 2)}
            </pre>
          )}
          <button
            type="button"
            onClick={onToggleRaw}
            className="w-full px-4 py-1.5 flex items-center justify-center gap-1 text-xs text-hooman-muted hover:text-zinc-400 hover:bg-hooman-border/20 transition-colors"
          >
            <Code className="w-3.5 h-3.5" />
            {showRaw ? "Hide" : "Show"} raw data
          </button>
        </article>
      );

    case "run_summary":
      return (
        <article
          className="rounded-xl border border-hooman-border bg-hooman-surface overflow-hidden"
          aria-label={`Run completed ${time}`}
        >
          <div className="flex items-start gap-3 px-4 py-3">
            <div className="rounded-lg bg-emerald-500/10 p-2 shrink-0">
              <CircleCheck className="w-4 h-4 text-emerald-500/90" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-medium text-white">
                  Run completed
                </h3>
                <time title={fullTime} className="text-xs text-hooman-muted">
                  {time}
                </time>
              </div>
              <div className="mt-2 flex flex-wrap gap-3 text-xs">
                <span className="text-zinc-400">
                  <span className="text-hooman-muted">Steps:</span>{" "}
                  {Number(p.stepCount) ?? "—"}
                </span>
                <span className="text-zinc-400">
                  <span className="text-hooman-muted">Tool calls:</span>{" "}
                  {Number(p.totalToolCalls) ?? "—"}
                </span>
                <span className="text-zinc-400">
                  <span className="text-hooman-muted">Finished:</span>{" "}
                  {String(p.finishReason ?? "—")}
                </span>
              </div>
            </div>
          </div>
          {showRaw && (
            <pre className="px-4 pb-3 pt-0 text-xs text-zinc-500 font-mono overflow-x-auto whitespace-pre-wrap border-t border-hooman-border/50 mt-2 pt-2">
              {JSON.stringify(entry.payload, null, 2)}
            </pre>
          )}
          <button
            type="button"
            onClick={onToggleRaw}
            className="w-full px-4 py-1.5 flex items-center justify-center gap-1 text-xs text-hooman-muted hover:text-zinc-400 hover:bg-hooman-border/20 transition-colors"
          >
            <Code className="w-3.5 h-3.5" />
            {showRaw ? "Hide" : "Show"} raw data
          </button>
        </article>
      );

    case "scheduled_task": {
      const intent = p.intent as string | undefined;
      const err = p.error as string | undefined;
      const ctx = p.context as Record<string, unknown> | undefined;
      return (
        <article
          className="rounded-xl border border-hooman-border bg-hooman-surface overflow-hidden"
          aria-label={`Scheduled task ${time}`}
        >
          <div className="flex items-start gap-3 px-4 py-3">
            <div
              className={`rounded-lg p-2 shrink-0 ${err ? "bg-red-500/15" : "bg-violet-500/15"}`}
            >
              <CalendarClock
                className={`w-4 h-4 ${err ? "text-red-400" : "text-violet-400"}`}
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-sm font-medium text-white">
                  {err ? "Scheduled task failed" : "Scheduled task ran"}
                </h3>
                <time title={fullTime} className="text-xs text-hooman-muted">
                  {time}
                </time>
              </div>
              <PayloadRow label="Intent" value={intent} />
              {ctx && Object.keys(ctx).length > 0 && (
                <div className="mt-1 text-xs text-zinc-400">
                  Context:{" "}
                  {Object.entries(ctx)
                    .map(([k, v]) => `${k}=${String(v)}`)
                    .join(", ")}
                </div>
              )}
              {p.execute_at && (
                <PayloadRow label="Executed at" value={String(p.execute_at)} />
              )}
              {p.cron && <PayloadRow label="Schedule" value={String(p.cron)} />}
              {err && <p className="mt-1.5 text-xs text-red-400">{err}</p>}
            </div>
          </div>
          {showRaw && (
            <pre className="px-4 pb-3 pt-0 text-xs text-zinc-500 font-mono overflow-x-auto whitespace-pre-wrap border-t border-hooman-border/50 mt-2 pt-2">
              {JSON.stringify(entry.payload, null, 2)}
            </pre>
          )}
          <button
            type="button"
            onClick={onToggleRaw}
            className="w-full px-4 py-1.5 flex items-center justify-center gap-1 text-xs text-hooman-muted hover:text-zinc-400 hover:bg-hooman-border/20 transition-colors"
          >
            <Code className="w-3.5 h-3.5" />
            {showRaw ? "Hide" : "Show"} raw data
          </button>
        </article>
      );
    }

    case "permission":
      return (
        <GenericAuditCard
          entry={entry}
          time={time}
          fullTime={fullTime}
          icon={<Shield className="w-4 h-4 text-sky-400" />}
          iconBg="bg-sky-500/15"
          title="Permission"
          showRaw={showRaw}
          onToggleRaw={onToggleRaw}
        />
      );
    case "memory_write":
      return (
        <GenericAuditCard
          entry={entry}
          time={time}
          fullTime={fullTime}
          icon={<Brain className="w-4 h-4 text-purple-400" />}
          iconBg="bg-purple-500/15"
          title="Memory updated"
          showRaw={showRaw}
          onToggleRaw={onToggleRaw}
        />
      );
    case "escalation":
      return (
        <GenericAuditCard
          entry={entry}
          time={time}
          fullTime={fullTime}
          icon={<AlertTriangle className="w-4 h-4 text-amber-400" />}
          iconBg="bg-amber-500/15"
          title="Escalation"
          showRaw={showRaw}
          onToggleRaw={onToggleRaw}
        />
      );
    case "action":
      return (
        <GenericAuditCard
          entry={entry}
          time={time}
          fullTime={fullTime}
          icon={<Zap className="w-4 h-4 text-yellow-400" />}
          iconBg="bg-yellow-500/15"
          title="Action"
          showRaw={showRaw}
          onToggleRaw={onToggleRaw}
        />
      );
    default:
      return (
        <GenericAuditCard
          entry={entry}
          time={time}
          fullTime={fullTime}
          icon={<Code className="w-4 h-4 text-zinc-400" />}
          iconBg="bg-zinc-500/15"
          title={entry.type.replace(/_/g, " ")}
          showRaw={showRaw}
          onToggleRaw={onToggleRaw}
        />
      );
  }
}

function GenericAuditCard({
  entry,
  time,
  fullTime,
  icon,
  iconBg,
  title,
  showRaw,
  onToggleRaw,
}: {
  entry: AuditEntry;
  time: string;
  fullTime: string;
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  showRaw: boolean;
  onToggleRaw: () => void;
}) {
  const p = entry.payload as Record<string, unknown>;
  const keys = Object.keys(p).filter(
    (k) => p[k] !== undefined && p[k] !== null && p[k] !== "",
  );
  return (
    <article
      className="rounded-xl border border-hooman-border bg-hooman-surface overflow-hidden"
      aria-label={`${title} ${time}`}
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <div className={`rounded-lg ${iconBg} p-2 shrink-0`}>{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-medium text-white capitalize">
              {title}
            </h3>
            <time title={fullTime} className="text-xs text-hooman-muted">
              {time}
            </time>
          </div>
          {keys.length > 0 && (
            <div className="mt-2 space-y-0.5">
              {keys.map((k) => (
                <PayloadRow
                  key={k}
                  label={k.replace(/_/g, " ")}
                  value={
                    typeof p[k] === "object"
                      ? JSON.stringify(p[k])
                      : String(p[k])
                  }
                  mono={typeof p[k] === "object"}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      {showRaw && (
        <pre className="px-4 pb-3 pt-0 text-xs text-zinc-500 font-mono overflow-x-auto whitespace-pre-wrap border-t border-hooman-border/50 mt-2 pt-2">
          {JSON.stringify(entry.payload, null, 2)}
        </pre>
      )}
      <button
        type="button"
        onClick={onToggleRaw}
        className="w-full px-4 py-1.5 flex items-center justify-center gap-1 text-xs text-hooman-muted hover:text-zinc-400 hover:bg-hooman-border/20 transition-colors"
      >
        <Code className="w-3.5 h-3.5" />
        {showRaw ? "Hide" : "Show"} raw data
      </button>
    </article>
  );
}

export function Audit() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRawByEntry, setShowRawByEntry] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    getAudit()
      .then((r) => setEntries(r.entries))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const socket = getSocket();
    socket.on("connect", load);
    return () => {
      socket.off("connect", load);
    };
  }, [load]);

  const toggleRaw = useCallback((id: string) => {
    setShowRawByEntry((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <div className="flex flex-col h-full min-h-0">
      <PageHeader title="Audit log" subtitle="See what Hooman did and why.">
        <Button
          onClick={load}
          variant="secondary"
          className="self-start sm:self-auto"
          icon={
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          }
        >
          Refresh
        </Button>
      </PageHeader>
      <div className="flex-1 overflow-y-auto p-4 md:p-6 min-h-0">
        {error && (
          <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 px-4 py-2 text-sm">
            {error}
          </div>
        )}
        {loading && entries.length === 0 ? (
          <p className="text-hooman-muted">Loading…</p>
        ) : entries.length === 0 ? (
          <div className="rounded-xl border border-hooman-border bg-hooman-surface/50 p-8 text-center">
            <p className="text-hooman-muted text-sm">
              No audit entries yet. Chat or run a task to generate activity.
            </p>
          </div>
        ) : (
          <ul className="space-y-4 list-none" role="list">
            {entries.map((e) => (
              <li key={e.id}>
                <AuditEntryCard
                  entry={e}
                  showRaw={showRawByEntry.has(e.id)}
                  onToggleRaw={() => toggleRaw(e.id)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
