import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  useFloating,
  offset,
  flip,
  shift,
  size as sizeMiddleware,
  autoUpdate,
} from "@floating-ui/react-dom";
import { ChevronDown, X, Loader2 } from "lucide-react";

export interface FilterListSelectOption {
  value: string;
  label: string;
}

export interface FilterListTab {
  label: string;
  options: FilterListSelectOption[];
}

export function FilterListSelect({
  label,
  value,
  onChange,
  fetchOptions,
  fetchTabs,
  placeholder = "Search and select…",
  disabled = false,
}: {
  label?: string;
  value: string;
  onChange: (commaSeparatedIds: string) => void;
  fetchOptions?: () => Promise<FilterListSelectOption[]>;
  /** When set, show tabs and load options per tab. Mutually exclusive with fetchOptions. */
  fetchTabs?: () => Promise<FilterListTab[]>;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [options, setOptions] = useState<FilterListSelectOption[]>([]);
  const [tabs, setTabs] = useState<FilterListTab[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { refs, floatingStyles } = useFloating({
    placement: "bottom-start",
    open,
    onOpenChange: setOpen,
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(4),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      sizeMiddleware({
        apply({ rects, availableHeight, elements }) {
          Object.assign(elements.floating.style, {
            minWidth: `${rects.reference.width}px`,
            maxHeight: `${Math.max(200, availableHeight - 16)}px`,
          });
        },
      }),
    ],
  });

  const selectedIds = value
    ? value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const selectedSet = new Set(selectedIds);

  const allOptions = tabs.length > 0 ? tabs.flatMap((t) => t.options) : options;
  const currentTabOptions =
    tabs.length > 0 && tabs[activeTabIndex]
      ? tabs[activeTabIndex].options
      : options;

  const loadOptions = async () => {
    if (loaded) return;
    setLoading(true);
    try {
      if (fetchTabs) {
        const list = await fetchTabs();
        setTabs(list);
        setActiveTabIndex(0);
      } else if (fetchOptions) {
        const list = await fetchOptions();
        setOptions(list);
      }
      setLoaded(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) loadOptions();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (listRef.current?.contains(target)) return;
      setOpen(false);
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

  const queryLower = query.trim().toLowerCase();
  const filtered =
    queryLower === ""
      ? currentTabOptions
      : currentTabOptions.filter(
          (o) =>
            o.value.toLowerCase().includes(queryLower) ||
            o.label.toLowerCase().includes(queryLower),
        );
  const hasTabs = tabs.length > 0;

  const toggle = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next].join(", "));
  };

  const remove = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = selectedIds.filter((x) => x !== id);
    onChange(next.join(", "));
  };

  return (
    <div
      ref={(el) => {
        containerRef.current = el;
        refs.setReference(el);
      }}
      className="space-y-1.5"
    >
      {label && (
        <label className="block text-xs font-medium text-hooman-muted uppercase tracking-wider">
          {label}
        </label>
      )}
      <div
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        className="min-h-[42px] w-full rounded-xl bg-hooman-surface border border-hooman-border px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-hooman-accent/50 focus-within:ring-offset-2 focus-within:ring-offset-hooman-bg focus-within:border-hooman-accent/50 transition-all"
      >
        <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
          {selectedIds.map((id) => {
            const opt = allOptions.find((o) => o.value === id);
            const display = opt?.label ?? id;
            return (
              <span
                key={id}
                className="inline-flex items-center gap-1 rounded-md bg-hooman-border/60 px-2 py-0.5 text-xs text-zinc-200"
              >
                <span className="truncate max-w-[180px]">{display}</span>
                {!disabled && (
                  <button
                    type="button"
                    onClick={(e) => remove(id, e)}
                    className="p-0.5 rounded hover:bg-hooman-muted/30 text-hooman-muted hover:text-zinc-200"
                    aria-label={`Remove ${display}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </span>
            );
          })}
        </div>
        <div className="flex items-center gap-1">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setOpen(true)}
            placeholder={
              selectedIds.length === 0 ? placeholder : "Search to add more…"
            }
            disabled={disabled}
            className="flex-1 min-w-0 bg-transparent border-0 p-0 text-sm text-zinc-200 placeholder:text-hooman-muted focus:outline-none focus:ring-0 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            disabled={disabled}
            className="p-1 rounded text-hooman-muted hover:text-zinc-200 hover:bg-hooman-border/50 disabled:opacity-50"
            aria-label={open ? "Close list" : "Open list"}
          >
            <ChevronDown
              className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>
        </div>
      </div>
      {open &&
        createPortal(
          <div
            ref={(el) => {
              refs.setFloating(el);
              listRef.current = el;
            }}
            className="rounded-xl border border-hooman-border bg-hooman-surface shadow-lg flex flex-col z-[100] overflow-hidden"
            style={{
              ...floatingStyles,
              minWidth: 280,
            }}
          >
            {hasTabs && (
              <div className="flex border-b border-hooman-border shrink-0">
                {tabs.map((tab, i) => (
                  <button
                    key={tab.label}
                    type="button"
                    onClick={() => setActiveTabIndex(i)}
                    className={`px-3 py-2 text-sm font-medium transition-colors ${
                      i === activeTabIndex
                        ? "text-hooman-accent border-b-2 border-hooman-accent -mb-px bg-hooman-border/20"
                        : "text-hooman-muted hover:text-zinc-200"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            )}
            <ul role="listbox" className="py-1 overflow-auto flex-1 min-h-0">
              {loading ? (
                <li className="px-3 py-4 flex items-center justify-center gap-2 text-hooman-muted text-sm">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading…
                </li>
              ) : filtered.length === 0 ? (
                <li className="px-3 py-4 text-hooman-muted text-sm">
                  {queryLower ? "No matches" : "No options"}
                </li>
              ) : (
                filtered.map((opt) => {
                  const isSelected = selectedSet.has(opt.value);
                  return (
                    <li
                      key={opt.value}
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => toggle(opt.value)}
                      className={`px-3 py-2 text-sm cursor-pointer transition-colors flex items-center gap-2 ${
                        isSelected
                          ? "bg-hooman-accent/20 text-hooman-accent"
                          : "text-zinc-200 hover:bg-hooman-border/50"
                      }`}
                    >
                      <span
                        className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${
                          isSelected
                            ? "bg-hooman-accent border-hooman-accent"
                            : "border-hooman-border"
                        }`}
                      >
                        {isSelected && (
                          <span className="text-white text-xs font-bold">
                            ✓
                          </span>
                        )}
                      </span>
                      <span className="truncate">{opt.label}</span>
                      <span className="text-hooman-muted text-xs truncate ml-auto max-w-[120px]">
                        {opt.value}
                      </span>
                    </li>
                  );
                })
              )}
            </ul>
          </div>,
          document.body,
        )}
    </div>
  );
}
