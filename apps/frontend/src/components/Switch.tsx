export interface SwitchProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  disabled?: boolean;
}

export function Switch({
  id,
  checked,
  onChange,
  label,
  disabled,
}: SwitchProps) {
  return (
    <label
      htmlFor={id}
      className={`flex items-center gap-2 cursor-pointer select-none w-fit ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <input
        type="checkbox"
        id={id}
        role="switch"
        aria-checked={checked}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="sr-only peer"
      />
      <span
        className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-hooman-accent/50 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-hooman-bg ${
          checked
            ? "bg-hooman-accent border-hooman-accent"
            : "bg-hooman-surface border-hooman-border"
        } ${!disabled ? "cursor-pointer" : ""}`}
        aria-hidden
      >
        <span
          className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm ring-0 transition-transform mt-0.5 ${
            checked ? "translate-x-6 ml-0" : "translate-x-0.5 ml-0.5"
          }`}
        />
      </span>
      {label != null && (
        <span className="text-sm font-medium text-zinc-300">{label}</span>
      )}
    </label>
  );
}
