"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius)] text-sm font-medium ring-offset-[var(--color-bg)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--color-accent)] text-[var(--color-accent-fg)] hover:opacity-90 active:opacity-80",
        secondary:
          "bg-[var(--color-muted)] text-[var(--color-fg)] hover:bg-[color-mix(in_srgb,var(--color-muted),var(--color-fg)_6%)]",
        outline:
          "border border-[var(--color-border)] bg-transparent text-[var(--color-fg)] hover:bg-[var(--color-muted)]",
        ghost: "bg-transparent text-[var(--color-fg)] hover:bg-[var(--color-muted)]",
        danger:
          "bg-[var(--color-danger)] text-white hover:opacity-90 active:opacity-80",
      },
      size: {
        sm: "h-9 px-3",
        md: "h-11 px-4",
        lg: "h-12 px-6 text-base",
        icon: "h-11 w-11",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, asChild = false, type, ...props },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    // Default to type="button" so a button nested in a form doesn't accidentally
    // submit. The form's actual submit button opts in explicitly.
    const resolvedType = asChild ? undefined : (type ?? "button");
    return (
      <Comp
        ref={ref}
        type={resolvedType}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";
