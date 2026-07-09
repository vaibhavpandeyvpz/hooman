import {
  Flame,
  Infinity as InfinityIcon,
  type LucideIcon,
  MessageCircleQuestion,
  NotebookPen,
} from "lucide-solid";

/**
 * Icon + accent color for each ACP session mode, mirroring the CLI TUI's
 * `StatusBar` palette. `yolo` (auto-approval on) is advertised as a standalone
 * boolean config option under the `model_config` category (see `CONFIG_ID_YOLO`
 * in `session-config.ts`) rather than a mode value; its red accent matches the
 * CLI's `yolo: on` indicator.
 */
export const MODE_META: Record<
  string,
  { icon: LucideIcon; className: string; label: string }
> = {
  agent: { icon: InfinityIcon, className: "text-foreground", label: "Agent" },
  ask: {
    icon: MessageCircleQuestion,
    className: "text-cyan-400",
    label: "Ask",
  },
  plan: { icon: NotebookPen, className: "text-amber-400", label: "Plan" },
  yolo: { icon: Flame, className: "text-red-400", label: "Yolo" },
};

export function modeMeta(modeId: string) {
  return (
    MODE_META[modeId] ?? {
      icon: InfinityIcon,
      className: "text-foreground",
      label: modeId,
    }
  );
}

/** Accent color per reasoning-effort level, same palette as the CLI TUI's `effort:` row. */
export const EFFORT_META: Record<string, { className: string; bars: number }> =
  {
    off: { className: "text-muted", bars: 0 },
    minimal: { className: "text-muted", bars: 1 },
    low: { className: "text-cyan-400", bars: 2 },
    medium: { className: "text-yellow-400", bars: 3 },
    high: { className: "text-red-400", bars: 4 },
  };

export function effortMeta(level: string) {
  return EFFORT_META[level] ?? { className: "text-fuchsia-400", bars: 3 };
}
