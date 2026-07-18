import type { ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn.js";

type Variant = "primary" | "secondary" | "ghost";

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-50 disabled:cursor-default",
        variant === "primary" &&
          "bg-hooman-primary text-white hover:bg-hooman-secondary",
        variant === "secondary" &&
          "bg-slate-800 text-slate-100 hover:bg-slate-700",
        variant === "ghost" &&
          "bg-transparent text-slate-300 hover:bg-slate-800",
        className,
      )}
      {...props}
    />
  );
}
