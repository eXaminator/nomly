"use client";

import * as React from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { SelectSearch } from "@/components/ui/select-search";
import { Checkbox } from "@/components/ui/checkbox";
import {
  searchUnitsWithAliases as searchUnits,
  resolveUnitPick,
} from "@/components/units/unit-picker";

import { newConversionDraft, type ConversionDraft } from "./types";

/** Per-ingredient unit-conversion editor ("1 ⟨von⟩ = ⟨Menge⟩ ⟨nach⟩").
 *  Controlled — the parent owns the draft list. */
export function ConversionsEditor({
  value,
  onChange,
}: {
  value: ConversionDraft[];
  onChange: (value: ConversionDraft[]) => void;
}) {
  function add() {
    onChange([...value, newConversionDraft()]);
  }

  function update(key: string, partial: Partial<ConversionDraft>) {
    onChange(value.map((c) => (c.key === key ? { ...c, ...partial } : c)));
  }

  function remove(key: string) {
    onChange(value.filter((c) => c.key !== key));
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>Umrechnungen</Label>
      <p className="text-xs text-[var(--color-muted-fg)]">
        Optional. Zutat-spezifische Umrechnungen für die Einkaufsliste — als
        „1 ⟨von⟩ = ⟨Menge⟩ ⟨nach⟩“. Ohne Gebinde-Haken normalisieren sie nur
        (z.&nbsp;B. Dichte „1 ml = 0,5 g“); mit Gebinde-Haken wird die
        aufsummierte Menge auf ganze ⟨von⟩ aufgerundet („1 Glas = 100 g“,
        „1 Stück = 10 Zehen“).
      </p>
      {value.length > 0 ? (
        <ul className="flex flex-col divide-y divide-[var(--color-border)] overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)]">
          {value.map((c) => (
            <li key={c.key} className="flex flex-col gap-2 px-3 py-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted-fg)]">
                <span className="shrink-0">1</span>
                <div className="min-w-0 flex-1">
                  <SelectSearch
                    value={c.from}
                    onChange={(p) => update(c.key, { from: resolveUnitPick(p) })}
                    search={searchUnits}
                    placeholder="von Einheit"
                  />
                </div>
                <span className="shrink-0">=</span>
                <div className="w-20">
                  <NumberInput
                    value={Number(c.factor.replace(",", ".")) || 0}
                    onChange={(n) =>
                      update(c.key, { factor: n == null ? "" : String(n) })
                    }
                    min={0.0001}
                    decimal
                    aria-label="Faktor"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <SelectSearch
                    value={c.to}
                    onChange={(p) => update(c.key, { to: resolveUnitPick(p) })}
                    search={searchUnits}
                    placeholder="nach Einheit"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(c.key)}
                  aria-label="Umrechnung entfernen"
                >
                  <X className="size-4" />
                </Button>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--color-muted-fg)]">
                <Checkbox
                  checked={c.isContainer}
                  onCheckedChange={(v) =>
                    update(c.key, { isContainer: Boolean(v) })
                  }
                />
                Gebinde (auf ganze ⟨von⟩ aufrunden)
              </label>
            </li>
          ))}
        </ul>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={add}
      >
        <Plus className="size-4" /> Umrechnung hinzufügen
      </Button>
    </div>
  );
}
