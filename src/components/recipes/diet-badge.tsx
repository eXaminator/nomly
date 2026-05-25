import { Leaf, Salad } from "lucide-react";
import { cn } from "@/lib/cn";
import type { DietConfidence } from "@/lib/recipes/diet";

type Props = {
  isVegan: boolean | null;
  isVegetarian: boolean | null;
  confidence: DietConfidence;
  size?: "sm" | "md";
  className?: string;
};

/**
 * Single badge: the strongest claim available. "probable" tier uses a dashed
 * outline + "Wahrscheinlich " prefix; "definite" uses the filled pill.
 * Nothing rendered when the recipe has no claim to make.
 */
export function DietBadge({
  isVegan,
  isVegetarian,
  confidence,
  size = "md",
  className,
}: Props) {
  if (isVegan === true) {
    return (
      <Badge
        kind="vegan"
        confidence={confidence}
        size={size}
        className={className}
        Icon={Leaf}
        baseLabel="Vegan"
      />
    );
  }
  if (isVegetarian === true) {
    return (
      <Badge
        kind="vegetarian"
        confidence={confidence}
        size={size}
        className={className}
        Icon={Salad}
        baseLabel="Vegetarisch"
      />
    );
  }
  return null;
}

function Badge({
  kind,
  confidence,
  size,
  className,
  Icon,
  baseLabel,
}: {
  kind: "vegan" | "vegetarian";
  confidence: DietConfidence;
  size: "sm" | "md";
  className?: string;
  Icon: typeof Leaf;
  baseLabel: string;
}) {
  const accent = kind === "vegan" ? "var(--color-success)" : "var(--color-warning)";
  const padding = size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs";
  const iconSize = size === "sm" ? "size-3" : "size-3.5";
  const isProbable = confidence === "probable";
  const label = isProbable ? `Wahrscheinlich ${baseLabel}` : baseLabel;
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1 rounded-full font-medium",
        padding,
        isProbable && "border border-dashed",
        className,
      )}
      style={{
        background: isProbable
          ? "transparent"
          : `color-mix(in srgb, ${accent}, var(--color-bg) 82%)`,
        color: accent,
        ...(isProbable ? { borderColor: accent } : {}),
      }}
    >
      <Icon className={iconSize} />
      {label}
    </span>
  );
}
