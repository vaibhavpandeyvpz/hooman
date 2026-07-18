import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/cn.js";

const alertVariants = cva(
  "relative grid w-full gap-0.5 rounded-md border px-2.5 py-2 text-left text-[12px] has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 *:[svg]:size-4 *:[svg]:translate-y-0.5",
  {
    variants: {
      variant: {
        default: "border-border bg-card text-foreground",
        destructive:
          "border-hooman-error/30 bg-hooman-error/10 text-hooman-error",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn("text-[12px]", className)}
      {...props}
    />
  );
}

export { Alert, AlertDescription };
