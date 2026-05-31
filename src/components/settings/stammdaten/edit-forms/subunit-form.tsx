"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";

import type { SubUnitManagedItem } from "@/lib/stammdaten/sub-unit/service";

export type SubUnitFormPayload = {
  name: string;
  plural: string | null;
  perPurchase: number;
};

/**
 * Drawer body for editing a single ingredient sub-unit. Publishes its payload
 * (and validity) up to the page client, which owns the PATCH call.
 */
export function SubUnitForm({
  item,
  onPayloadChange,
}: {
  item: SubUnitManagedItem;
  onPayloadChange: (payload: SubUnitFormPayload, valid: boolean) => void;
}) {
  const [name, setName] = React.useState(item.name);
  const [plural, setPlural] = React.useState(item.plural ?? "");
  const [perPurchase, setPerPurchase] = React.useState<number>(item.perPurchase);

  React.useEffect(() => {
    const trimmed = name.trim();
    const valid =
      trimmed.length > 0 && Number.isFinite(perPurchase) && perPurchase > 0;
    onPayloadChange(
      {
        name: trimmed,
        plural: plural.trim() ? plural.trim() : null,
        perPurchase: Number.isFinite(perPurchase) && perPurchase > 0 ? perPurchase : 1,
      },
      valid,
    );
  }, [name, plural, perPurchase, onPayloadChange]);

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-[var(--radius)] bg-[var(--color-muted)] px-3 py-2 text-sm text-[var(--color-muted-fg)]">
        Zutat: <span className="font-medium text-[var(--color-fg)]">{item.ingredientName}</span>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="subunit-name">Name</Label>
        <Input
          id="subunit-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="z. B. Zehe"
          autoFocus
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="subunit-plural">Plural (optional)</Label>
        <Input
          id="subunit-plural"
          value={plural}
          onChange={(e) => setPlural(e.target.value)}
          placeholder="z. B. Zehen"
        />
        <p className="text-xs text-[var(--color-muted-fg)]">
          Wird beim Import zusätzlich erkannt und bei jeder Menge außer 1
          angezeigt.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="subunit-perpurchase">pro Einkaufseinheit</Label>
        <NumberInput
          id="subunit-perpurchase"
          value={perPurchase}
          onChange={(n) => setPerPurchase(n ?? 1)}
          min={0.0001}
          decimal
        />
        <p className="text-xs text-[var(--color-muted-fg)]">
          Wie viele {plural.trim() || name.trim() || "Untereinheiten"} in einer
          Einkaufseinheit stecken (z. B. 10 Zehen pro Knoblauchstück).
        </p>
      </div>
    </div>
  );
}
