"use client";

import * as React from "react";
import { AlertTriangle, ArrowLeftRight, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectSearch } from "@/components/ui/select-search";
import { cn } from "@/lib/cn";
import {
  searchUnitsWithAliases as searchUnits,
  resolveUnitPick,
} from "@/components/units/unit-picker";
import { findAliasCollisions } from "@/components/settings/stammdaten/alias-collisions";

import { newAliasDraft, type AliasDraft } from "./types";
import { CrossCollisionNote, type CrossCollisionMap } from "./cross-collisions";

/**
 * Alias rows editor: per-alias name, display rename, and default unit, with
 * advisory near-duplicate and cross-ingredient collision notes. Controlled.
 *
 * Edit-only concerns are opt-in:
 * - `onSwapWithName` enables the "promote alias to canonical name" button. When
 *   omitted (create flows, where there's nothing to swap against yet) the
 *   button is hidden.
 * - `footer` renders extra content after the "add alias" button (the full
 *   editor uses it for the rename-propagation opt-in).
 */
export function AliasesEditor({
  value,
  onChange,
  name,
  crossCollisions,
  onSwapWithName,
  footer,
}: {
  value: AliasDraft[];
  onChange: (value: AliasDraft[]) => void;
  name: string;
  crossCollisions: CrossCollisionMap;
  onSwapWithName?: (key: string) => void;
  footer?: React.ReactNode;
}) {
  const aliasCollisions = React.useMemo(
    () => findAliasCollisions(name, value.map((a) => a.name)),
    [name, value],
  );

  function add() {
    onChange([...value, newAliasDraft()]);
  }

  function update(key: string, partial: Partial<AliasDraft>) {
    onChange(value.map((a) => (a.key === key ? { ...a, ...partial } : a)));
  }

  function remove(key: string) {
    onChange(value.filter((a) => a.key !== key));
  }

  return (
    <div className="flex flex-col gap-2">
      <Label>Aliase</Label>
      <p className="text-xs text-[var(--color-muted-fg)]">
        Alternative Namen für diese Zutat. Pro Alias lässt sich optional
        eine Standard-Einheit setzen — z.&nbsp;B. „Knoblauchzehe“ →
        „Zehe“, oder „Olivenöl extra virgin“ → „ml“. Ohne Default fällt
        der Import auf die globale Standard-Einheit „Stück“ zurück. Mit einem
        „Anzeigename“ wird die Zeile umbenannt, wenn dieser Alias trifft —
        z.&nbsp;B. „Knoblauchzehe“ → Anzeige „Knoblauch“, damit
        „3&nbsp;Zehen Knoblauch“ statt „3&nbsp;Zehen Knoblauchzehe“ steht.
      </p>
      {value.length > 0 ? (
        <ul className="flex flex-col divide-y divide-[var(--color-border)] overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)]">
          {value.map((alias, idx) => {
            const collision = aliasCollisions.get(idx);
            return (
              <li key={alias.key} className="flex flex-col gap-1 px-3 py-2">
                <div className="flex flex-col gap-2 sm:grid sm:grid-cols-[1fr_1fr_minmax(8rem,12rem)_auto] sm:items-center">
                  <Input
                    value={alias.name}
                    onChange={(e) => update(alias.key, { name: e.target.value })}
                    placeholder="Alias-Name"
                    aria-label="Alias-Name"
                    className={cn(
                      collision &&
                        "ring-1 ring-[var(--color-warning)] focus-visible:ring-[var(--color-warning)]",
                    )}
                  />
                  <Input
                    value={alias.displayName}
                    onChange={(e) =>
                      update(alias.key, { displayName: e.target.value })
                    }
                    placeholder="Anzeigename (optional)"
                    aria-label="Anzeigename beim Treffer"
                  />
                  <SelectSearch
                    value={alias.defaultUnit}
                    onChange={(picked) =>
                      update(alias.key, { defaultUnit: resolveUnitPick(picked) })
                    }
                    search={searchUnits}
                    placeholder="Default-Einheit…"
                  />
                  <div className="flex items-center gap-1">
                    {onSwapWithName ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => onSwapWithName(alias.key)}
                        disabled={
                          alias.name.trim().length === 0 ||
                          name.trim().length === 0
                        }
                        aria-label={`${alias.name || "Alias"} zum Namen machen`}
                        title="Mit dem Namen tauschen — der Alias wird zum Namen des Artikels (inkl. Standard-Einheit), der bisherige Name zum Alias."
                      >
                        <ArrowLeftRight className="size-4" />
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => remove(alias.key)}
                      aria-label={`${alias.name || "Alias"} entfernen`}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                </div>
                {collision && (
                  <p className="flex items-center gap-1 text-xs text-[var(--color-warning)]">
                    <AlertTriangle className="size-3 shrink-0" aria-hidden />
                    {collision.collidesWith === "name"
                      ? "Quasi identisch mit dem Namen."
                      : "Quasi identisch mit einem anderen Alias."}
                  </p>
                )}
                <CrossCollisionNote
                  hits={crossCollisions.get(alias.name.trim().toLowerCase())}
                />
              </li>
            );
          })}
        </ul>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={add}
      >
        <Plus className="size-4" /> Alias hinzufügen
      </Button>
      {footer}
    </div>
  );
}
