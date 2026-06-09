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
 * The app's standard unit picker (alias-aware), wrapped for the shopping-list
 * dialogs. Mirrors the recipe ingredient row: lists canonical units and their
 * aliases (matching plurals too) and collapses an alias pick to the real unit
 * id via {@link resolveUnitPick}. New units are created only in Stammdaten —
 * never inline — so a typo can't mint a duplicate unit.
 */
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
    />
  );
}
