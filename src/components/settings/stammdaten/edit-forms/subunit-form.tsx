"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { SelectSearch } from "@/components/ui/select-search";

import type { SubUnitManagedItem } from "@/lib/stammdaten/sub-unit/service";

export type SubUnitFormPayload = {
  name: string;
  plural: string | null;
  parentUnitId: number | null;
  parentAmount: number;
};

async function searchUnits(q: string): Promise<Array<{ id: number; name: string }>> {
  const res = await fetch(`/api/v1/units/manage?q=${encodeURIComponent(q)}`);
  if (!res.ok) return [];
  const body = (await res.json()) as { items: Array<{ id: number; name: string }> };
  return body.items.map((u) => ({ id: u.id, name: u.name }));
}

/**
 * Drawer body for editing a single ingredient custom unit. A custom unit
 * either converts into a parent global unit (`1 ⟨name⟩ = amount ⟨parent⟩`) or
 * is **standalone** (no parent) and stays its own line on the shopping list.
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
  const [parent, setParent] = React.useState<{ id: number; name: string } | null>(
    item.parentUnitId != null && item.parentUnitName != null
      ? { id: item.parentUnitId, name: item.parentUnitName }
      : null,
  );
  const [amountText, setAmountText] = React.useState<string>(
    item.parentUnitId != null ? String(item.parentAmount) : "1",
  );

  React.useEffect(() => {
    const trimmed = name.trim();
    const amount = Number(amountText.replace(",", "."));
    const amountValid = !parent || (Number.isFinite(amount) && amount > 0);
    onPayloadChange(
      {
        name: trimmed,
        plural: plural.trim() ? plural.trim() : null,
        parentUnitId: parent?.id ?? null,
        parentAmount: parent && Number.isFinite(amount) && amount > 0 ? amount : 1,
      },
      trimmed.length > 0 && amountValid,
    );
  }, [name, plural, parent, amountText, onPayloadChange]);

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
      </div>

      <div className="flex flex-col gap-2">
        <Label>Umrechnung</Label>
        <div className="flex items-center gap-2 text-sm text-[var(--color-muted-fg)]">
          <span className="shrink-0">1</span>
          <div className="min-w-0 flex-1">
            <SelectSearch
              value={parent}
              onChange={setParent}
              search={searchUnits}
              placeholder="eigenständig (kein Parent)"
            />
          </div>
          {parent && (
            <>
              <span className="shrink-0">=</span>
              <div className="w-24">
                <NumberInput
                  value={Number(amountText.replace(",", ".")) || 0}
                  onChange={(n) => setAmountText(n == null ? "" : String(n))}
                  min={0.0001}
                  decimal
                  aria-label="Anzahl pro übergeordneter Einheit"
                />
              </div>
              <span className="shrink-0">{plural.trim() || name.trim() || "Einheiten"}</span>
            </>
          )}
        </div>
        <p className="text-xs text-[var(--color-muted-fg)]">
          Wähle eine übergeordnete Einheit (z.&nbsp;B. „Stück“ oder „g“), in die
          diese Untereinheit für die Einkaufsliste umgerechnet wird. Ohne
          übergeordnete Einheit bleibt sie eigenständig (z.&nbsp;B. „2 Stangen“).
        </p>
      </div>
    </div>
  );
}
