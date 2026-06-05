import * as React from "react";
import type { ShoppingItemAmount } from "@/lib/shopping/items";
import { formatQty } from "@/lib/shopping/format";
import { cn } from "@/lib/cn";

/** Aggregated amount lines joined with "+" — e.g. "1,5 kg + 2 Stück (12 Zehen)".
 *  Renders nothing when no line carries a quantity or unit. */
export function AmountList({
  amounts,
  className,
}: {
  amounts: ShoppingItemAmount[];
  className?: string;
}) {
  const visible = amounts.filter(
    (a) => a.quantity != null || a.unitName != null,
  );
  if (visible.length === 0) return null;
  return (
    <span className={cn("text-sm text-[var(--color-muted-fg)]", className)}>
      {visible.map((a, i) => (
        <React.Fragment key={i}>
          {i > 0 ? <span className="mx-1">+</span> : null}
          <span>
            {a.quantity != null ? formatQty(a.quantity) : ""}
            {a.unitName ? `${a.quantity != null ? " " : ""}${a.unitName}` : ""}
            {a.baseQuantity != null && a.baseUnitName
              ? ` (${formatQty(a.baseQuantity)} ${a.baseUnitName})`
              : ""}
          </span>
        </React.Fragment>
      ))}
    </span>
  );
}
