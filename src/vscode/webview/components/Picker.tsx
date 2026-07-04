import { createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import { Check, ChevronDown } from "lucide-solid";

export interface PickerOption {
  value: string;
  label: string;
  description?: string;
  icon?: JSX.Element;
}

/**
 * A small pill-shaped dropdown used for the composer's mode/model/effort
 * selectors — replaces the bare native `<select>` with a menu that can show
 * per-option icons/descriptions and match the trigger's icon/color styling.
 */
export default function Picker(props: {
  icon?: JSX.Element;
  label: string;
  className?: string;
  value: string;
  options: PickerOption[];
  onSelect: (value: string) => void;
  title?: string;
}) {
  const [open, setOpen] = createSignal(false);
  let rootRef: HTMLDivElement | undefined;

  const onDocClick = (event: MouseEvent) => {
    if (rootRef && !rootRef.contains(event.target as Node)) {
      setOpen(false);
    }
  };

  const toggle = () => {
    const next = !open();
    setOpen(next);
    if (next) {
      document.addEventListener("mousedown", onDocClick, { capture: true });
    } else {
      document.removeEventListener("mousedown", onDocClick, { capture: true });
    }
  };

  onCleanup(() =>
    document.removeEventListener("mousedown", onDocClick, { capture: true }),
  );

  return (
    <div class="relative" ref={rootRef}>
      <button
        type="button"
        title={props.title}
        class={`flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11.5px] hover:bg-panel ${props.className ?? ""}`}
        onClick={toggle}
      >
        {props.icon}
        <span class="max-w-[9em] truncate">{props.label}</span>
        <ChevronDown size={11} class="opacity-60" />
      </button>
      <Show when={open()}>
        <div class="absolute bottom-full left-0 z-10 mb-1 max-h-56 min-w-[11em] overflow-y-auto rounded-md border border-border bg-panel py-1 shadow-lg scroll-thin">
          <For each={props.options}>
            {(option) => (
              <button
                type="button"
                class="flex w-full items-center gap-2 px-2.5 py-1 text-left text-[12px] hover:bg-list-active-bg hover:text-list-active-fg"
                onClick={() => {
                  props.onSelect(option.value);
                  setOpen(false);
                }}
              >
                {option.icon}
                <span class="min-w-0 flex-1 truncate">{option.label}</span>
                <Show when={option.value === props.value}>
                  <Check size={12} />
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
