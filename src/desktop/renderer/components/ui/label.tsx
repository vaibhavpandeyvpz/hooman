import * as React from "react";
import { Label as LabelPrimitive } from "radix-ui";

import { cn } from "../../lib/cn.js";

function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground select-none",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
