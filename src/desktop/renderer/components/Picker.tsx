import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../lib/cn.js";

export type PickerOption = {
  value: string;
  label: string;
  description?: string;
  icon?: ReactNode;
};

/**
 * A small pill-shaped dropdown for the composer's model/effort/mode
 * selectors — a React port of the VS Code webview's `Picker.tsx`, same
 * interaction model (click to open, click-outside/Escape to close).
 */
export function Picker(props: {
  icon?: ReactNode;
  label: string;
  className?: string;
  value: string;
  options: PickerOption[];
  onSelect: (value: string) => void;
  title?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick, { capture: true });
    return () =>
      document.removeEventListener("mousedown", onDocClick, { capture: true });
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        title={props.title}
        disabled={props.disabled}
        className={cn(
          "flex items-center gap-1.5 rounded-md border border-slate-800 px-2.5 py-1 text-[12px] hover:bg-slate-800 disabled:opacity-50",
          props.className,
        )}
        onClick={() => setOpen((v) => !v)}
      >
        {props.icon}
        <span className="max-w-[9em] truncate">{props.label}</span>
        <ChevronDown size={11} className="opacity-60" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-1 max-h-56 min-w-[12em] overflow-y-auto rounded-md border border-slate-800 bg-slate-900 py-1 shadow-lg">
          {props.options.map((option) => (
            <button
              key={option.value}
              type="button"
              className={cn(
                "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12.5px] hover:bg-slate-800",
                option.value === props.value && "bg-slate-800",
              )}
              onClick={() => {
                props.onSelect(option.value);
                setOpen(false);
              }}
            >
              {option.icon}
              <span className="min-w-0 flex-1 truncate">
                {option.label}
                {option.description && (
                  <span className="ml-1.5 text-hooman-muted">
                    {option.description}
                  </span>
                )}
              </span>
              {option.value === props.value && <Check size={12} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
