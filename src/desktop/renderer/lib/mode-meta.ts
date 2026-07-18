import {
  Infinity as InfinityIcon,
  MessageCircleQuestionMark,
  NotebookPen,
  Palette,
  type LucideIcon,
} from "lucide-react";

/**
 * Icon + accent color for each ACP session mode, mirroring the CLI TUI's
 * `StatusBar` palette (and the VS Code webview's `lib/meta.ts`). Yolo
 * (auto-approve) is a separate boolean config option, not a mode value.
 */
export const MODE_META: Record<
  string,
  { icon: LucideIcon; className: string }
> = {
  agent: { icon: InfinityIcon, className: "text-slate-100" },
  ask: { icon: MessageCircleQuestionMark, className: "text-hooman-primary" },
  plan: { icon: NotebookPen, className: "text-hooman-warning" },
  design: { icon: Palette, className: "text-hooman-secondary" },
};

export function modeMeta(modeId: string) {
  return (
    MODE_META[modeId] ?? { icon: InfinityIcon, className: "text-slate-100" }
  );
}

/** Accent color per reasoning-effort level, same palette as the CLI TUI's `effort:` row. */
export const EFFORT_META: Record<string, { className: string; bars: number }> =
  {
    off: { className: "text-hooman-muted", bars: 0 },
    minimal: { className: "text-hooman-muted", bars: 1 },
    low: { className: "text-hooman-primary", bars: 2 },
    medium: { className: "text-hooman-warning", bars: 3 },
    high: { className: "text-hooman-error", bars: 4 },
  };

export function effortMeta(level: string) {
  return EFFORT_META[level] ?? { className: "text-hooman-secondary", bars: 3 };
}
