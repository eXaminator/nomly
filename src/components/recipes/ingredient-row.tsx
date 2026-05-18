"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { IngredientNameInput } from "./ingredient-name-input";
import type { DraftIngredient } from "./types";

async function searchUnits(q: string): Promise<ComboboxItem[]> {
  const r = await fetch(`/api/v1/units?q=${encodeURIComponent(q)}`);
  if (!r.ok) return [];
  const data = (await r.json()) as {
    items: Array<{ id: number; name: string; matchedAlias?: string }>;
  };
  return data.items.map((i) => ({
    id: i.id,
    name: i.name,
    detail:
      i.matchedAlias && i.matchedAlias !== i.name ? `≈ ${i.matchedAlias}` : undefined,
  }));
}

type Props = {
  value: DraftIngredient;
  onChange: (next: DraftIngredient) => void;
  onRemove: () => void;
};

export function IngredientRow({ value, onChange, onRemove }: Props) {
  return (
    <div className="grid grid-cols-[5rem_8rem_1fr_auto] gap-2 md:grid-cols-[5rem_8rem_1fr_1fr_auto]">
      <Input
        inputMode="decimal"
        placeholder="Menge"
        value={value.quantity}
        onChange={(e) => onChange({ ...value, quantity: e.target.value })}
        aria-label="Menge"
      />
      <Combobox
        value={value.unit}
        onChange={(unit) => onChange({ ...value, unit })}
        search={searchUnits}
        placeholder="Einheit"
      />
      <IngredientNameInput
        value={value.name}
        onChange={(name) => onChange({ ...value, name })}
        placeholder="Zutat"
        className="col-span-2 md:col-span-1"
      />
      <Input
        placeholder="Notiz (z. B. fein gehackt)"
        value={value.notes}
        onChange={(e) => onChange({ ...value, notes: e.target.value })}
        aria-label="Notiz"
        className="col-span-3 md:col-span-1"
      />
      <Button
        variant="ghost"
        size="icon"
        onClick={onRemove}
        aria-label="Zutat entfernen"
        className="col-start-4 md:col-start-5"
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}
