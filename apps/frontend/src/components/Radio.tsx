export interface RadioProps {
  name: string;
  value: string;
  checked: boolean;
  onChange: () => void;
  label?: React.ReactNode;
  disabled?: boolean;
}

export function Radio({
  name,
  value,
  checked,
  onChange,
  label,
  disabled,
}: RadioProps) {
  return (
    <label
      htmlFor={`${name}-${value}`}
      className={`flex items-center gap-2 cursor-pointer select-none w-fit ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <input
        type="radio"
        id={`${name}-${value}`}
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="sr-only peer"
      />
      <span
        className={`flex items-center justify-center w-5 h-5 rounded-full border shrink-0 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-hooman-accent/50 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-hooman-bg ${
          checked ? "border-hooman-accent" : "border-hooman-border"
        }`}
        aria-hidden
      >
        {checked ? (
          <span className="w-2 h-2 rounded-full bg-hooman-accent shrink-0" />
        ) : null}
      </span>
      {label != null && (
        <span className="text-sm font-medium text-zinc-300">{label}</span>
      )}
    </label>
  );
}
