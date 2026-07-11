import {
  Infinity as InfinityIcon,
  type LucideIcon,
  MessageCircleQuestionMark,
  NotebookPen,
  Palette,
} from "lucide-solid";

/**
 * Icon + accent color for each ACP session mode, mirroring the CLI TUI's
 * `StatusBar` palette. Yolo (auto-approve) is a separate boolean config option
 * (`CONFIG_ID_YOLO` in `session-config.ts`), not a mode value.
 */
export const MODE_META: Record<
  string,
  { icon: LucideIcon; className: string; label: string }
> = {
  agent: { icon: InfinityIcon, className: "text-foreground", label: "Agent" },
  ask: {
    icon: MessageCircleQuestionMark,
    className: "text-primary",
    label: "Ask",
  },
  plan: { icon: NotebookPen, className: "text-warning", label: "Plan" },
  design: { icon: Palette, className: "text-secondary", label: "Design" },
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
