import { useRef, useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown } from "lucide-react";

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
}

export interface SelectProps<T extends string = string> {
  id?: string;
  label?: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  placeholder?: string;
  "aria-label"?: string;
}

export function Select<T extends string = string>({
  id,
  label,
  value,
  options,
  onChange,
  disabled = false,
  placeholder = "Select…",
  "aria-label": ariaLabel,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [popupPosition, setPopupPosition] = useState({
    top: 0,
    left: 0,
    minWidth: 0,
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLUListElement>(null);

  const selected = options.find((o) => o.value === value);
  const display = selected?.label ?? placeholder;

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPopupPosition({
      top: rect.bottom + 4,
      left: rect.left,
      minWidth: rect.width,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      const inTrigger = containerRef.current?.contains(target);
      const inPopup = popupRef.current?.contains(target);
      if (!inTrigger && !inPopup) setOpen(false);
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      {label && (
        <label
          htmlFor={id}
          className="block text-xs text-hooman-muted uppercase tracking-wide mb-1"
        >
          {label}
        </label>
      )}
      <button
        ref={triggerRef}
        type="button"
        id={id}
        aria-label={ariaLabel ?? label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className="w-full rounded-lg bg-hooman-bg border border-hooman-border px-3 py-2 text-sm text-zinc-200 text-left flex items-center justify-between gap-2 hover:border-hooman-muted/50 focus:outline-none focus:ring-2 focus:ring-hooman-accent/50 focus:ring-offset-2 focus:ring-offset-hooman-bg disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <span className="truncate">{display}</span>
        <ChevronDown
          className={`w-4 h-4 shrink-0 text-hooman-muted transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {open &&
        createPortal(
          <ul
            ref={popupRef}
            role="listbox"
            className="fixed rounded-lg border border-hooman-border bg-hooman-surface py-1 shadow-lg max-h-60 overflow-auto z-[100]"
            style={{
              top: popupPosition.top,
              left: popupPosition.left,
              minWidth: popupPosition.minWidth,
            }}
          >
            {options.map((opt) => (
              <li
                key={opt.value}
                role="option"
                aria-selected={opt.value === value}
                onClick={() => {
                  onChange(opt.value as T);
                  setOpen(false);
                }}
                className={`px-3 py-2 text-sm cursor-pointer transition-colors ${
                  opt.value === value
                    ? "bg-hooman-accent/20 text-hooman-accent"
                    : "text-zinc-200 hover:bg-hooman-border/50"
                }`}
              >
                {opt.label}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </div>
  );
}
