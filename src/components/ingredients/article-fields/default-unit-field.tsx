"use client";

import * as React from "react";
import { Label } from "@/components/ui/label";
import { SelectSearch } from "@/components/ui/select-search";
import {
  searchUnitsWithAliases as searchUnits,
  resolveUnitPick,
} from "@/components/units/unit-picker";

import type { UnitPick } from "./types";

const DEFAULT_DESCRIPTION =
  "Optional. Welche Einheit der Import annimmt, wenn die Zutat über ihren " +
  "kanonischen Namen (ohne Alias) und ohne explizite Einheit erkannt wird. " +
  "Ohne Default fällt der Import auf „Stück“ zurück.";

/** Canonical-name default unit picker (alias-aware). Controlled. */
export function DefaultUnitField({
  value,
  onChange,
  label = "Standard-Einheit des Namens",
  description = DEFAULT_DESCRIPTION,
}: {
  value: UnitPick;
  onChange: (value: UnitPick) => void;
  label?: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      {description ? (
        <p className="text-xs text-[var(--color-muted-fg)]">{description}</p>
      ) : null}
      <SelectSearch
        value={value}
        onChange={(p) => onChange(resolveUnitPick(p))}
        search={searchUnits}
        placeholder="Default-Einheit…"
      />
    </div>
  );
}
