"use client";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import type { DraftIngredient } from "./types";

async function searchIngredients(q: string): Promise<ComboboxItem[]> {
  const r = await fetch(`/api/v1/ingredients?q=${encodeURIComponent(q)}`);
  if (!r.ok) return [];
  const data = (await r.json()) as {
    items: Array<{ id: number; name: string; matchedAlias?: string }>;
  };
  return data.items.map((i) => ({
    id: i.id,
    name: i.name,
    detail: i.matchedAlias && i.matchedAlias !== i.name ? `≈ ${i.matchedAlias}` : undefined,
  }));
}

async function createIngredient(name: string): Promise<ComboboxItem> {
  const r = await fetch("/api/v1/ingredients", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!r.ok) {
    const err = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `HTTP ${r.status}`);
  }
  const data = (await r.json()) as { id: number; name: string };
  return { id: data.id, name: data.name };
}

async function searchUnits(q: string): Promise<ComboboxItem[]> {
  const r = await fetch(`/api/v1/units?q=${encodeURIComponent(q)}`);
  if (!r.ok) return [];
  const data = (await r.json()) as {
    items: Array<{ id: number; name: string; matchedAlias?: string }>;
  };
  return data.items.map((i) => ({
    id: i.id,
    name: i.name,
    detail: i.matchedAlias && i.matchedAlias !== i.name ? `≈ ${i.matchedAlias}` : undefined,
  }));
}

async function createUnit(name: string): Promise<ComboboxItem> {
  // Inline-created units default to count dimension; richer edits live in Epic 7.
  const r = await fetch("/api/v1/units", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, dimension: "count" }),
  });
  if (!r.ok) {
    const err = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `HTTP ${r.status}`);
  }
  const data = (await r.json()) as { id: number; name: string };
  return { id: data.id, name: data.name };
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
        onCreate={createUnit}
        placeholder="Einheit"
      />
      <Combobox
        value={value.ingredient}
        onChange={(ingredient) => onChange({ ...value, ingredient })}
        search={searchIngredients}
        onCreate={createIngredient}
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
        type="button"
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
