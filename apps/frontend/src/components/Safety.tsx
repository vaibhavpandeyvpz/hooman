import { useState, useEffect } from "react";
import createDebug from "debug";
import { RotateCcw, Trash2 } from "lucide-react";
import {
  getKillSwitch,
  setKillSwitch,
  getToolApproval,
  setToolApproval,
  getAllowEveryTimeTools,
  resetAllowEveryTime,
  type AllowEveryTimeTool,
} from "../api";
import { PageHeader } from "./PageHeader";

const debug = createDebug("hooman:Safety");

export function Safety() {
  const [killSwitch, setKillSwitchState] = useState(false);
  const [allowEverything, setAllowEverythingState] = useState(false);
  const [allowEveryTimeTools, setAllowEveryTimeTools] = useState<
    AllowEveryTimeTool[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState<string | "all" | null>(null);

  function loadSafety() {
    return Promise.all([
      getKillSwitch(),
      getToolApproval(),
      getAllowEveryTimeTools(),
    ]).then(([kill, approval, tools]) => {
      setKillSwitchState(kill.enabled);
      setAllowEverythingState(approval.allowEverything);
      setAllowEveryTimeTools(tools.tools ?? []);
    });
  }

  useEffect(() => {
    loadSafety().finally(() => setLoading(false));
  }, []);

  async function toggleKillSwitch() {
    const next = !killSwitch;
    try {
      await setKillSwitch(next);
      setKillSwitchState(next);
    } catch (e) {
      debug("%o", e);
    }
  }

  async function toggleAllowEverything() {
    const next = !allowEverything;
    try {
      await setToolApproval(next);
      setAllowEverythingState(next);
    } catch (e) {
      debug("%o", e);
    }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <PageHeader
        title="Safety & control"
        subtitle="Pause Hooman or control what it’s allowed to do."
      />
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 min-h-0">
        <div className="rounded-xl border border-hooman-border bg-hooman-surface p-4">
          <h3 className="font-medium text-white mb-2">Global kill switch</h3>
          <p className="text-sm text-hooman-muted mb-4">
            When the kill switch is on, Hooman is paused and no events are
            processed. Turn it off to resume.
          </p>
          {loading ? (
            <p className="text-hooman-muted text-sm">Loading…</p>
          ) : (
            <button
              onClick={toggleKillSwitch}
              className={`rounded-lg px-4 py-2 font-medium text-sm ${
                killSwitch
                  ? "bg-hooman-green/20 text-hooman-green"
                  : "bg-hooman-red/20 text-hooman-red"
              }`}
            >
              {killSwitch
                ? "Hooman paused — click to resume"
                : "Hooman active — click to pause"}
            </button>
          )}
        </div>

        <div className="rounded-xl border border-hooman-border bg-hooman-surface p-4">
          <h3 className="font-medium text-white mb-2">Allow everything</h3>
          <p className="text-sm text-hooman-muted mb-4">
            When on, all tool calls run without asking for approval. When off,
            you will be prompted to allow or reject each tool call (or say
            &ldquo;always&rdquo; to allow that tool every time).
          </p>
          {!loading && (
            <button
              onClick={toggleAllowEverything}
              className={`rounded-lg px-4 py-2 font-medium text-sm ${
                allowEverything
                  ? "bg-hooman-green/20 text-hooman-green"
                  : "bg-hooman-border/50 text-hooman-muted"
              }`}
            >
              {allowEverything
                ? "Allow everything — click to require approval"
                : "Require approval — click to allow everything"}
            </button>
          )}
        </div>

        <div className="rounded-xl border border-hooman-border bg-hooman-surface p-4">
          <h3 className="font-medium text-white mb-2">
            Tools allowed every time
          </h3>
          <p className="text-sm text-hooman-muted mb-4">
            Tools you approved with &ldquo;Allow every time&rdquo; skip the
            approval prompt. Reset them to require approval again.
          </p>
          {loading ? (
            <p className="text-hooman-muted text-sm">Loading…</p>
          ) : allowEveryTimeTools.length === 0 ? (
            <p className="text-hooman-muted text-sm italic py-2">
              No tools are set to allow every time.
            </p>
          ) : (
            <div className="space-y-4">
              <ul className="space-y-2">
                {allowEveryTimeTools.map((t) => (
                  <li
                    key={t.toolId}
                    className="flex items-center justify-between gap-3 rounded-lg border border-hooman-border/50 bg-hooman-border/10 px-4 py-3 transition-colors hover:border-hooman-border"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-sm font-medium text-zinc-200">
                        {t.name}
                      </span>
                      {t.connectionName && (
                        <span className="mt-1 inline-block rounded-md bg-hooman-border/30 px-1.5 py-0.5 text-xs text-hooman-muted">
                          {t.connectionName}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      disabled={resetting !== null}
                      onClick={async () => {
                        setResetting(t.toolId);
                        try {
                          await resetAllowEveryTime([t.toolId]);
                          await loadSafety();
                        } catch (e) {
                          debug("%o", e);
                        } finally {
                          setResetting(null);
                        }
                      }}
                      className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-xs font-medium text-red-300 transition-colors hover:border-red-500/50 hover:bg-red-500/20 disabled:opacity-50 disabled:hover:bg-red-500/10"
                    >
                      {resetting === t.toolId ? (
                        <RotateCcw className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                      Reset
                    </button>
                  </li>
                ))}
              </ul>
              <div className="pt-1 border-t border-hooman-border/50">
                <button
                  type="button"
                  disabled={resetting !== null}
                  onClick={async () => {
                    setResetting("all");
                    try {
                      await resetAllowEveryTime();
                      await loadSafety();
                    } catch (e) {
                      debug("%o", e);
                    } finally {
                      setResetting(null);
                    }
                  }}
                  className="inline-flex items-center gap-2 rounded-lg border border-hooman-border bg-hooman-border/20 px-3 py-2 text-sm font-medium text-zinc-300 transition-colors hover:border-hooman-border hover:bg-hooman-border/30 hover:text-white disabled:opacity-50 disabled:hover:bg-hooman-border/20"
                >
                  <RotateCcw
                    className={`h-4 w-4 shrink-0 ${resetting === "all" ? "animate-spin" : ""}`}
                  />
                  Reset all
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
