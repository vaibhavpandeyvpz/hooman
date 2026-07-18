import { ChevronDown, Folder } from "lucide-react";

/** Header control showing the active session's folder; click to browse and switch to another one. */
export function FolderSwitcher({
  cwd,
  onChoose,
  loading,
}: {
  cwd: string | null;
  onChoose: () => void;
  loading: boolean;
}) {
  const label = loading
    ? "Starting…"
    : cwd
      ? cwd.split("/").pop() || cwd
      : "Choose a folder…";

  return (
    <button
      type="button"
      title={cwd ?? undefined}
      disabled={loading}
      onClick={onChoose}
      className="flex items-center gap-1.5 rounded-md border border-slate-800 px-2.5 py-1 text-[13px] hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Folder size={13} className="text-hooman-muted" />
      <span className="max-w-[16em] truncate">{label}</span>
      <ChevronDown size={12} className="opacity-60" />
    </button>
  );
}
