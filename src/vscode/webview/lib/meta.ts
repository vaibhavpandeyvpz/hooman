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
 * in `session-config.ts`) rather than a mode value; its error accent matches the
 * CLI's `yolo: on` indicator.
 */
export const MODE_META: Record<
  string,
  { icon: LucideIcon; className: string; label: string }
> = {
  agent: { icon: InfinityIcon, className: "text-foreground", label: "Agent" },
  ask: {
    icon: MessageCircleQuestion,
    className: "text-primary",
    label: "Ask",
  },
  plan: { icon: NotebookPen, className: "text-warning", label: "Plan" },
  yolo: { icon: Flame, className: "text-error", label: "Yolo" },
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
    low: { className: "text-primary", bars: 2 },
    medium: { className: "text-warning", bars: 3 },
    high: { className: "text-error", bars: 4 },
  };

export function effortMeta(level: string) {
  return EFFORT_META[level] ?? { className: "text-secondary", bars: 3 };
}
