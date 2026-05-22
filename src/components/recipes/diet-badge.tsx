import { Leaf, Salad } from "lucide-react";
import { cn } from "@/lib/cn";

type Props = {
  isVegan: boolean | null;
  isVegetarian: boolean | null;
  size?: "sm" | "md";
  className?: string;
};

/**
 * Renders nothing when the recipe is not vegetarian (no claim to make) or
 * when the verdict is "unknown" (some ingredient is untagged) — surfacing
 * "neither" would just be noise. Show a single badge: the strongest claim
 * we can make, since "vegan" implies "vegetarian".
 */
export function DietBadge({ isVegan, isVegetarian, size = "md", className }: Props) {
  if (isVegan === true) {
    return (
      <Badge
        kind="vegan"
        size={size}
        className={className}
        Icon={Leaf}
        label="Vegan"
      />
    );
  }
  if (isVegetarian === true) {
    return (
      <Badge
        kind="vegetarian"
        size={size}
        className={className}
        Icon={Salad}
        label="Vegetarisch"
      />
    );
  }
  return null;
}

function Badge({
  kind,
  size,
  className,
  Icon,
  label,
}: {
  kind: "vegan" | "vegetarian";
  size: "sm" | "md";
  className?: string;
  Icon: typeof Leaf;
  label: string;
}) {
  // Color mixes keep the badge legible in both light and dark modes by
  // sampling against --color-bg, the way the warning/danger pills elsewhere
  // in the app do.
  const accent = kind === "vegan" ? "var(--color-success)" : "var(--color-warning)";
  const padding = size === "sm" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs";
  const iconSize = size === "sm" ? "size-3" : "size-3.5";
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center gap-1 rounded-full font-medium",
        padding,
        className,
      )}
      style={{
        background: `color-mix(in srgb, ${accent}, var(--color-bg) 82%)`,
        color: accent,
      }}
    >
      <Icon className={iconSize} />
      {label}
    </span>
  );
}
