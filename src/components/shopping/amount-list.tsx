import * as React from "react";
import type { ShoppingItemAmount } from "@/lib/shopping/items";
import { formatQty } from "@/lib/shopping/format";
import { cn } from "@/lib/cn";

/** Aggregated amount lines joined with "+" — e.g. "1,5 kg + 2 Stück (12 Zehen)".
 *
 *  When the item also has sources that carry no specific quantity
 *  (`unspecifiedCount`), a trailing "+ N ohne Menge" is appended so that
 *  un-quantified demand isn't hidden behind the sum of the quantified sources.
 *  This only happens once at least one quantified line is shown — when nothing
 *  is quantified the total isn't misleading, so the count is left off and the
 *  existing rendering (which may surface a bare unit like "etwas") is kept. */
export function AmountList({
  amounts,
  unspecifiedCount = 0,
  className,
}: {
  amounts: ShoppingItemAmount[];
  unspecifiedCount?: number;
  className?: string;
}) {
  const numeric = amounts.filter((a) => a.quantity != null);

  if (numeric.length === 0) {
    // No quantified demand: keep the prior behaviour (show any unit-only line,
    // e.g. "etwas"; render nothing when there's truly nothing to show) and
    // never tack on a count.
    const visible = amounts.filter(
      (a) => a.quantity != null || a.unitName != null,
    );
    if (visible.length === 0) return null;
    return (
      <span className={cn("text-sm text-[var(--color-muted-fg)]", className)}>
        {visible.map((a, i) => (
          <React.Fragment key={i}>
            {i > 0 ? <span className="mx-1">+</span> : null}
            <span>{a.unitName ?? ""}</span>
          </React.Fragment>
        ))}
      </span>
    );
  }

  return (
    <span className={cn("text-sm text-[var(--color-muted-fg)]", className)}>
      {numeric.map((a, i) => (
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
      {unspecifiedCount > 0 ? (
        <>
          <span className="mx-1">+</span>
          <span className="italic">{unspecifiedCount} ohne Menge</span>
        </>
      ) : null}
    </span>
  );
}
