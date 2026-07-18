import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "../../lib/cn.js";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent text-xs font-medium outline-none transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:border-hooman-secondary focus-visible:ring-2 focus-visible:ring-hooman-secondary/50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default: "bg-hooman-primary text-white hover:bg-hooman-secondary",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/70",
        outline: "border-border bg-transparent text-foreground hover:bg-muted",
        ghost:
          "bg-transparent text-muted-foreground hover:bg-muted hover:text-foreground",
        destructive:
          "bg-hooman-error/10 text-hooman-error hover:bg-hooman-error/20",
      },
      size: {
        default: "h-8 px-2.5",
        sm: "h-7 px-2 text-[11px]",
        icon: "size-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
