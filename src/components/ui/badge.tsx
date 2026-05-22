import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        default: "bg-[var(--color-muted)] text-[var(--color-fg)]",
        accent: "bg-[var(--color-accent)] text-[var(--color-accent-fg)]",
        success:
          "bg-[color-mix(in_srgb,var(--color-success),transparent_80%)] text-[var(--color-success)]",
        warning:
          "bg-[color-mix(in_srgb,var(--color-warning),transparent_80%)] text-[var(--color-warning)]",
        danger:
          "bg-[color-mix(in_srgb,var(--color-danger),transparent_80%)] text-[var(--color-danger)]",
        outline:
          "border border-[var(--color-border)] bg-transparent text-[var(--color-muted-fg)]",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span
      className={cn(badgeVariants({ variant, className }))}
      {...props}
    />
  );
}
