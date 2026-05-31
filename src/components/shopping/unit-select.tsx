"use client";

import * as React from "react";
import {
  SelectSearch,
  type SelectSearchItem,
} from "@/components/ui/select-search";
import {
  resolveUnitPick,
  searchUnitsWithAliases,
} from "@/components/units/unit-picker";

/**
 * The app's standard unit picker (alias-aware, create-on-the-fly), wrapped for
 * the shopping-list dialogs. Mirrors the recipe ingredient row: lists canonical
 * units and their aliases, collapses an alias pick to the real unit id via
 * {@link resolveUnitPick}, and can create a new (count) unit inline.
 */
async function createUnit(name: string): Promise<SelectSearchItem> {
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

export function UnitSelect({
  value,
  onChange,
  className,
  placeholder = "Einheit",
  disabled,
}: {
  value: { id: number; name: string } | null;
  onChange: (next: { id: number; name: string } | null) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [defaultUnits, setDefaultUnits] = React.useState<SelectSearchItem[]>([]);
  React.useEffect(() => {
    void searchUnitsWithAliases("").then(setDefaultUnits);
  }, []);
  return (
    <SelectSearch
      value={value}
      onChange={(picked) => onChange(resolveUnitPick(picked))}
      search={searchUnitsWithAliases}
      defaultItems={defaultUnits}
      placeholder={placeholder}
      className={className}
      disabled={disabled}
      onCreate={createUnit}
      createLabelPrefix="als Einheit anlegen"
    />
  );
}
