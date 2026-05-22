"use client";

import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/cn";

export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      // `inline-flex items-center justify-center` + `align-middle` keeps
      // the button's baseline stable: without them, switching between empty
      // (unchecked) and child-bearing (checked) states shifts the inline
      // baseline and grows the surrounding line box, making whole table rows
      // jump in height when a row is selected.
      "peer inline-flex size-5 shrink-0 items-center justify-center rounded-[6px] border border-[var(--color-border)] bg-[var(--color-bg)] align-middle transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-[var(--color-accent)] data-[state=checked]:text-[var(--color-accent-fg)] data-[state=checked]:border-[var(--color-accent)] data-[state=indeterminate]:bg-[var(--color-accent)] data-[state=indeterminate]:text-[var(--color-accent-fg)] data-[state=indeterminate]:border-[var(--color-accent)]",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center">
      {props.checked === "indeterminate" ? (
        <Minus className="size-3.5" />
      ) : (
        <Check className="size-3.5" />
      )}
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = "Checkbox";
