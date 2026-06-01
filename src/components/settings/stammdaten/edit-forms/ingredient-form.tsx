"use client";

import * as React from "react";
import { AlertTriangle, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import { SelectSearch } from "@/components/ui/select-search";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/cn";
import {
  searchUnitsWithAliases as searchUnits,
  resolveUnitPick,
} from "@/components/units/unit-picker";

import { ImpactSection } from "../impact-section";
import { findAliasCollisions } from "../alias-collisions";
import type { EditFormProps } from "../list-shell";

export type IngredientItem = {
  id: number;
  name: string;
  aliases: string[];
  aliasUnitDefaults: Array<{
    aliasName: string;
    unitId: number;
    unitName: string;
  }>;
  /** Per-alias display rename, keyed by alias name. */
  aliasDisplayNames: Record<string, string>;
  /** Per-ingredient unit conversions (`1 from = factor × to`). */
  conversions: Array<{
    id: number;
    fromUnitId: number;
    fromUnitName: string;
    toUnitId: number;
    toUnitName: string;
    factor: number;
    isContainer: boolean;
  }>;
  /** Canonical-name parser default unit. */
  defaultUnitId: number | null;
  defaultUnitName: string | null;
  defaultCategoryId: number | null;
  defaultCategoryName: string | null;
  excludeFromShoppingList: boolean;
  isEquipment: boolean;
  dietaryClass: "vegan" | "vegetarian" | "meat" | null;
  /** Supermarkets this article is marked unavailable at. */
  excludedSupermarkets: Array<{ id: number; name: string }>;
  recipeRefCount: number;
};

const DIET_OPTIONS = [
  { value: "vegan", label: "Vegan" },
  { value: "vegetarian", label: "Vegetarisch" },
  { value: "meat", label: "Tierisch" },
] as const;

type AliasDraft = {
  key: string;
  name: string;
  /** Per-alias default global unit. */
  defaultUnit: { id: number; name: string } | null;
  /** Per-alias display rename — shown on recipe rows instead of the alias. */
  displayName: string;
};

/**
 * One conversion edge in the editor. Reads "1 ⟨from⟩ = ⟨factor⟩ ⟨to⟩". A
 * container edge (`isContainer`) is the "buy whole packs" rule — the per-
 * component total rounds up to whole ⟨from⟩; a non-container edge is plain
 * normalization (density: "1 ml = 0,5 g"; count breakdown: "1 Stück = 10 Zehe").
 */
type ConversionDraft = {
  key: string;
  from: { id: number; name: string } | null;
  to: { id: number; name: string } | null;
  factor: string;
  isContainer: boolean;
};

export function IngredientForm({
  item,
  onPayloadChange,
}: EditFormProps<IngredientItem>) {
  const [name, setName] = React.useState(item?.name ?? "");
  const [conversions, setConversions] = React.useState<ConversionDraft[]>(() =>
    (item?.conversions ?? []).map((c) => ({
      key: `existing-${c.id}`,
      from: { id: c.fromUnitId, name: c.fromUnitName },
      to: { id: c.toUnitId, name: c.toUnitName },
      factor: String(c.factor),
      isContainer: c.isContainer,
    })),
  );
  const [aliases, setAliases] = React.useState<AliasDraft[]>(() => {
    const defaultsByAliasLower = new Map<string, { id: number; name: string }>();
    for (const d of item?.aliasUnitDefaults ?? []) {
      defaultsByAliasLower.set(d.aliasName.toLowerCase(), {
        id: d.unitId,
        name: d.unitName,
      });
    }
    const displayByAlias = item?.aliasDisplayNames ?? {};
    return (item?.aliases ?? []).map((aliasName) => ({
      key: `existing-${aliasName}`,
      name: aliasName,
      defaultUnit: defaultsByAliasLower.get(aliasName.toLowerCase()) ?? null,
      displayName: displayByAlias[aliasName] ?? "",
    }));
  });
  // Opt-in: also rewrite the matching display names on existing recipes when
  // the canonical name or an existing alias is renamed here.
  const [propagateRenames, setPropagateRenames] = React.useState(false);
  const [category, setCategory] = React.useState<{
    id: number;
    name: string;
  } | null>(
    item && item.defaultCategoryId && item.defaultCategoryName
      ? { id: item.defaultCategoryId, name: item.defaultCategoryName }
      : null,
  );
  const [canonicalDefault, setCanonicalDefault] = React.useState<{
    id: number;
    name: string;
  } | null>(
    item?.defaultUnitId != null && item?.defaultUnitName != null
      ? { id: item.defaultUnitId, name: item.defaultUnitName }
      : null,
  );
  const [excludeFromShoppingList, setExclude] = React.useState(
    item?.excludeFromShoppingList ?? false,
  );
  const [isEquipment, setIsEquipment] = React.useState(
    item?.isEquipment ?? false,
  );
  const [dietaryClass, setDietaryClass] = React.useState<
    "vegan" | "vegetarian" | "meat" | null
  >(item?.dietaryClass ?? null);
  const [excludedSupermarkets, setExcludedSupermarkets] = React.useState<
    Array<{ id: number; name: string }>
  >(item?.excludedSupermarkets ?? []);

  // Renames the user made to the canonical name or to EXISTING aliases (whose
  // key encodes the original name). New/removed aliases aren't renames. Used to
  // offer propagating the change into existing recipes' display names.
  const renamePairs = React.useMemo(() => {
    if (!item) return [] as Array<{ from: string; to: string }>;
    const pairs: Array<{ from: string; to: string }> = [];
    const seen = new Set<string>();
    const push = (from: string, to: string) => {
      const f = from.trim();
      const t = to.trim();
      if (f.length === 0 || t.length === 0 || f === t) return;
      const k = f.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      pairs.push({ from: f, to: t });
    };
    push(item.name, name);
    const prefix = "existing-";
    for (const a of aliases) {
      if (a.key.startsWith(prefix)) push(a.key.slice(prefix.length), a.name);
    }
    return pairs;
  }, [item, name, aliases]);

  // Aliases virtually identical to the canonical name or to another alias —
  // surfaced as a non-blocking, per-row warning. Keyed by row index.
  const aliasCollisions = React.useMemo(
    () => findAliasCollisions(name, aliases.map((a) => a.name)),
    [name, aliases],
  );

  React.useEffect(() => {
    const trimmedName = name.trim();
    const aliasNames = aliases.map((a) => a.name.trim()).filter((n) => n.length > 0);
    const valid = trimmedName.length > 0;
    const conversionsPayload = conversions
      .filter((c) => {
        const factor = Number(c.factor.replace(",", "."));
        return (
          c.from != null &&
          c.to != null &&
          c.from.id !== c.to.id &&
          Number.isFinite(factor) &&
          factor > 0
        );
      })
      .map((c) => ({
        fromUnitId: c.from!.id,
        toUnitId: c.to!.id,
        factor: Number(c.factor.replace(",", ".")),
        isContainer: c.isContainer,
      }));
    const aliasUnitDefaultsPayload: Array<{
      aliasName: string;
      unitId: number;
      unitDisplay: string;
    }> = [];
    const aliasDisplayNamesPayload: Record<string, string> = {};
    for (const alias of aliases) {
      const aliasName = alias.name.trim();
      if (aliasName.length === 0) continue;
      if (alias.defaultUnit) {
        aliasUnitDefaultsPayload.push({
          aliasName,
          unitId: alias.defaultUnit.id,
          // The picked spelling (a unit alias like "clove", or the canonical).
          unitDisplay: alias.defaultUnit.name,
        });
      }
      const display = alias.displayName.trim();
      if (display.length > 0) aliasDisplayNamesPayload[aliasName] = display;
    }
    onPayloadChange(
      {
        name: trimmedName,
        aliases: aliasNames,
        aliasUnitDefaults: aliasUnitDefaultsPayload,
        aliasDisplayNames: aliasDisplayNamesPayload,
        conversions: conversionsPayload,
        defaultUnitId: canonicalDefault?.id ?? null,
        defaultUnitDisplay: canonicalDefault?.name ?? null,
        defaultCategoryId: category?.id ?? null,
        excludeFromShoppingList,
        isEquipment,
        dietaryClass,
        excludedSupermarketIds: excludedSupermarkets.map((s) => s.id),
        // Propagation rider — ignored by the server unless propagateRenames is
        // true (and only applied for exact display_name matches).
        renamePairs,
        propagateRenames: propagateRenames && renamePairs.length > 0,
      },
      valid,
    );
  }, [
    name,
    aliases,
    conversions,
    canonicalDefault,
    category,
    excludeFromShoppingList,
    isEquipment,
    dietaryClass,
    excludedSupermarkets,
    renamePairs,
    propagateRenames,
    onPayloadChange,
  ]);

  async function searchCategories(q: string) {
    const res = await fetch(`/api/v1/categories?q=${encodeURIComponent(q)}`);
    if (!res.ok) return [];
    const body = (await res.json()) as {
      items: Array<{ id: number; name: string }>;
    };
    return body.items;
  }

  const searchSupermarkets = React.useCallback(
    async (q: string) => {
      const res = await fetch(
        `/api/v1/supermarkets/manage?q=${encodeURIComponent(q)}`,
      );
      if (!res.ok) return [];
      const body = (await res.json()) as {
        items: Array<{ id: number; name: string }>;
      };
      const taken = new Set(excludedSupermarkets.map((s) => s.id));
      return body.items
        .filter((s) => !taken.has(s.id))
        .map((s) => ({ id: s.id, name: s.name }));
    },
    [excludedSupermarkets],
  );

  function addExcludedSupermarket(picked: { id: number; name: string } | null) {
    if (!picked) return;
    setExcludedSupermarkets((prev) =>
      prev.some((s) => s.id === picked.id)
        ? prev
        : [...prev, { id: picked.id, name: picked.name }],
    );
  }

  function removeExcludedSupermarket(id: number) {
    setExcludedSupermarkets((prev) => prev.filter((s) => s.id !== id));
  }

  function addConversion() {
    setConversions((prev) => [
      ...prev,
      {
        key: `new-${crypto.randomUUID()}`,
        from: null,
        to: null,
        factor: "1",
        isContainer: false,
      },
    ]);
  }

  function updateConversion(key: string, partial: Partial<ConversionDraft>) {
    setConversions((prev) =>
      prev.map((c) => (c.key === key ? { ...c, ...partial } : c)),
    );
  }

  function removeConversion(key: string) {
    setConversions((prev) => prev.filter((c) => c.key !== key));
  }

  function addAlias() {
    setAliases((prev) => [
      ...prev,
      {
        key: `new-${crypto.randomUUID()}`,
        name: "",
        defaultUnit: null,
        displayName: "",
      },
    ]);
  }

  function updateAlias(key: string, partial: Partial<AliasDraft>) {
    setAliases((prev) =>
      prev.map((a) => (a.key === key ? { ...a, ...partial } : a)),
    );
  }

  function removeAlias(key: string) {
    setAliases((prev) => prev.filter((a) => a.key !== key));
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="ingredient-name">Name</Label>
        <Input
          id="ingredient-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Umrechnungen</Label>
        <p className="text-xs text-[var(--color-muted-fg)]">
          Optional. Zutat-spezifische Umrechnungen für die Einkaufsliste — als
          „1 ⟨von⟩ = ⟨Menge⟩ ⟨nach⟩“. Ohne Gebinde-Haken normalisieren sie nur
          (z.&nbsp;B. Dichte „1 ml = 0,5 g“); mit Gebinde-Haken wird die
          aufsummierte Menge auf ganze ⟨von⟩ aufgerundet („1 Glas = 100 g“,
          „1 Stück = 10 Zehen“).
        </p>
        {conversions.length > 0 ? (
          <ul className="flex flex-col divide-y divide-[var(--color-border)] overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)]">
            {conversions.map((c) => (
              <li key={c.key} className="flex flex-col gap-2 px-3 py-2">
                <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--color-muted-fg)]">
                  <span className="shrink-0">1</span>
                  <div className="min-w-0 flex-1">
                    <SelectSearch
                      value={c.from}
                      onChange={(p) =>
                        updateConversion(c.key, { from: resolveUnitPick(p) })
                      }
                      search={searchUnits}
                      placeholder="von Einheit"
                    />
                  </div>
                  <span className="shrink-0">=</span>
                  <div className="w-20">
                    <NumberInput
                      value={Number(c.factor.replace(",", ".")) || 0}
                      onChange={(n) =>
                        updateConversion(c.key, {
                          factor: n == null ? "" : String(n),
                        })
                      }
                      min={0.0001}
                      decimal
                      aria-label="Faktor"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <SelectSearch
                      value={c.to}
                      onChange={(p) =>
                        updateConversion(c.key, { to: resolveUnitPick(p) })
                      }
                      search={searchUnits}
                      placeholder="nach Einheit"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeConversion(c.key)}
                    aria-label="Umrechnung entfernen"
                  >
                    <X className="size-4" />
                  </Button>
                </div>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--color-muted-fg)]">
                  <Checkbox
                    checked={c.isContainer}
                    onCheckedChange={(v) =>
                      updateConversion(c.key, { isContainer: Boolean(v) })
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
          onClick={addConversion}
        >
          <Plus className="size-4" /> Umrechnung hinzufügen
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Standard-Einheit des Namens</Label>
        <p className="text-xs text-[var(--color-muted-fg)]">
          Optional. Welche Einheit der Import annimmt, wenn die Zutat über
          ihren kanonischen Namen (ohne Alias) und ohne explizite Einheit
          erkannt wird. Ohne Default fällt der Import auf „Stück“ zurück.
        </p>
        <SelectSearch
          value={canonicalDefault}
          onChange={(p) => setCanonicalDefault(resolveUnitPick(p))}
          search={searchUnits}
          placeholder="Default-Einheit…"
        />
      </div>

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
        {aliases.length > 0 ? (
          <ul className="flex flex-col divide-y divide-[var(--color-border)] overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)]">
            {aliases.map((alias, idx) => {
              const collision = aliasCollisions.get(idx);
              return (
                <li key={alias.key} className="flex flex-col gap-1 px-3 py-2">
                  <div className="grid grid-cols-[1fr_minmax(8rem,14rem)_auto] items-center gap-2">
                    <Input
                      value={alias.name}
                      onChange={(e) =>
                        updateAlias(alias.key, { name: e.target.value })
                      }
                      placeholder="Alias-Name"
                      aria-label="Alias-Name"
                      className={cn(
                        collision &&
                          "ring-1 ring-[var(--color-warning)] focus-visible:ring-[var(--color-warning)]",
                      )}
                    />
                    <SelectSearch
                      value={alias.defaultUnit}
                      onChange={(picked) =>
                        updateAlias(alias.key, {
                          defaultUnit: resolveUnitPick(picked),
                        })
                      }
                      search={searchUnits}
                      placeholder="Default-Einheit…"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeAlias(alias.key)}
                      aria-label={`${alias.name || "Alias"} entfernen`}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                  <Input
                    value={alias.displayName}
                    onChange={(e) =>
                      updateAlias(alias.key, { displayName: e.target.value })
                    }
                    placeholder="Anzeigename beim Treffer (optional, z. B. Knoblauch)"
                    aria-label="Anzeigename beim Treffer"
                    className="text-sm"
                  />
                  {collision && (
                    <p className="flex items-center gap-1 text-xs text-[var(--color-warning)]">
                      <AlertTriangle className="size-3 shrink-0" aria-hidden />
                      {collision.collidesWith === "name"
                        ? "Quasi identisch mit dem Namen."
                        : "Quasi identisch mit einem anderen Alias."}
                    </p>
                  )}
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
          onClick={addAlias}
        >
          <Plus className="size-4" /> Alias hinzufügen
        </Button>
        {renamePairs.length > 0 ? (
          <label className="mt-1 flex cursor-pointer items-start gap-2 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-muted)] px-3 py-2 text-sm">
            <Checkbox
              checked={propagateRenames}
              onCheckedChange={(v) => setPropagateRenames(Boolean(v))}
              className="mt-0.5"
            />
            <span className="flex-1">
              <span className="font-medium">
                Umbenennungen auf bestehende Rezepte übertragen
              </span>
              <span className="mt-0.5 block text-xs text-[var(--color-muted-fg)]">
                Ersetzt den Anzeigenamen in vorhandenen Rezeptzeilen, die exakt
                so heißen:{" "}
                {renamePairs
                  .map((p) => `„${p.from}“ → „${p.to}“`)
                  .join(", ")}
                . Sonst bleiben bestehende Rezepte unverändert.
              </span>
            </span>
          </label>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label>Kategorie</Label>
        <p className="text-xs text-[var(--color-muted-fg)]">
          In welcher Regalreihe die Zutat normalerweise landet. Beim
          Hinzufügen zur Einkaufsliste übernommen, dort pro Eintrag
          überschreibbar.
        </p>
        <SelectSearch
          value={category}
          onChange={setCategory}
          search={searchCategories}
          placeholder="Kategorie auswählen…"
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <div>
          <Label>Von Einkaufsliste ausschließen</Label>
          <p className="text-xs text-[var(--color-muted-fg)]">
            Bei aktivierter Option wird der Artikel nicht in die Einkaufsliste
            übernommen.
          </p>
        </div>
        <Switch
          checked={excludeFromShoppingList}
          onCheckedChange={(v) => setExclude(Boolean(v))}
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <div>
          <Label>Ausrüstung</Label>
          <p className="text-xs text-[var(--color-muted-fg)]">
            Hat der Nutzer in der Regel auf Vorrat (Backpapier, Einmachgläser,
            …). Rezept-Zeilen mit diesem Artikel sind standardmäßig optional —
            der Nutzer entscheidet pro Rezept, ob die Position einkaufen muss.
          </p>
        </div>
        <Switch
          checked={isEquipment}
          onCheckedChange={(v) => setIsEquipment(Boolean(v))}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Diät-Klasse</Label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <button
            type="button"
            onClick={() => setDietaryClass(null)}
            className={
              "rounded-[var(--radius)] border px-3 py-2 text-sm transition-colors " +
              (dietaryClass === null
                ? "border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent),transparent_88%)] text-[var(--color-fg)]"
                : "border-[var(--color-border)] hover:bg-[var(--color-muted)]")
            }
          >
            Unbekannt
          </button>
          {DIET_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setDietaryClass(opt.value)}
              className={
                "rounded-[var(--radius)] border px-3 py-2 text-sm transition-colors " +
                (dietaryClass === opt.value
                  ? "border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent),transparent_88%)] text-[var(--color-fg)]"
                  : "border-[var(--color-border)] hover:bg-[var(--color-muted)]")
              }
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Nicht verfügbar bei</Label>
        <p className="text-xs text-[var(--color-muted-fg)]">
          Supermärkte, die diesen Artikel nicht führen. Auf der Einkaufsliste
          werden passende Einträge im jeweiligen Markt ausgegraut.
        </p>
        {excludedSupermarkets.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {excludedSupermarkets.map((s) => (
              <li key={s.id}>
                <span className="inline-flex items-center gap-1 rounded-[var(--radius)] border border-[var(--color-border)] bg-[var(--color-muted)] py-1 pl-2.5 pr-1 text-sm">
                  {s.name}
                  <button
                    type="button"
                    onClick={() => removeExcludedSupermarket(s.id)}
                    aria-label={`${s.name} entfernen`}
                    className="inline-flex size-5 items-center justify-center rounded-md text-[var(--color-muted-fg)] hover:bg-[var(--color-bg)] hover:text-[var(--color-fg)]"
                  >
                    <X className="size-3.5" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <SelectSearch
          value={null}
          onChange={addExcludedSupermarket}
          search={searchSupermarkets}
          placeholder="Supermarkt hinzufügen…"
        />
      </div>

      {item && <ImpactSection entityKind="ingredient" id={item.id} />}
    </div>
  );
}
