"use client";

import * as React from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumberInput } from "@/components/ui/number-input";
import {
  SelectSearch,
  type SelectSearchItem,
} from "@/components/ui/select-search";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";

import { ImpactSection } from "../impact-section";
import type { EditFormProps } from "../list-shell";

export type IngredientItem = {
  id: number;
  name: string;
  aliases: string[];
  aliasUnitDefaults: Array<{
    aliasName: string;
    unitId: number | null;
    subUnitId: number | null;
    unitName: string;
  }>;
  subUnits: Array<{ id: number; name: string; perPurchase: number }>;
  /** Canonical-name parser default (mirrors aliasUnitDefaults). Exactly one of
   *  defaultUnitId / defaultSubUnitId is set, or both null. */
  defaultUnitId: number | null;
  defaultUnitName: string | null;
  defaultSubUnitId: number | null;
  defaultCategoryId: number | null;
  defaultCategoryName: string | null;
  purchaseUnitId: number | null;
  purchaseUnitName: string | null;
  excludeFromShoppingList: boolean;
  isEquipment: boolean;
  dietaryClass: "vegan" | "vegetarian" | "meat" | null;
  recipeRefCount: number;
};

const DIET_OPTIONS = [
  { value: "vegan", label: "Vegan" },
  { value: "vegetarian", label: "Vegetarisch" },
  { value: "meat", label: "Tierisch" },
] as const;

/**
 * Sub-unit row in the editor. `tempKey` stays stable across renders so
 * alias-default references survive name edits. `existingId` is the DB id
 * for rows that came back from the loaded ingredient — used to map saved
 * `default_sub_unit_id` references back to a tempKey on initial load.
 */
type SubUnitDraft = {
  tempKey: string;
  existingId?: number;
  name: string;
  perPurchase: number;
};

/**
 * Per-alias state. `defaultUnit` either points at a global unit row or at
 * one of this ingredient's sub-units (by sub-unit `tempKey` — id isn't yet
 * known for rows the user just added in this same edit session).
 */
type AliasUnitRef =
  | { kind: "unit"; unitId: number; unitName: string }
  | { kind: "subUnit"; tempKey: string };

type AliasDraft = {
  key: string;
  name: string;
  defaultUnit: AliasUnitRef | null;
};

/**
 * Synthetic numeric id used by the combined unit/sub-unit picker so it can
 * still rely on `SelectSearchItem.id: number`. Global units get their own
 * positive `unit.id`; the picker rewrites local sub-units to a negative id
 * derived from their position in the current `subUnits` array. The negation
 * lets us tell sub-units from global units without changing SelectSearch's
 * shape.
 */
const SUB_UNIT_OFFSET = 1;
function subUnitPickerId(localIndex: number): number {
  return -(localIndex + SUB_UNIT_OFFSET);
}
function decodeSubUnitIndex(pickerId: number): number | null {
  if (pickerId >= 0) return null;
  return -pickerId - SUB_UNIT_OFFSET;
}

export function IngredientForm({
  item,
  onPayloadChange,
}: EditFormProps<IngredientItem>) {
  const [name, setName] = React.useState(item?.name ?? "");
  const [subUnits, setSubUnits] = React.useState<SubUnitDraft[]>(
    () =>
      (item?.subUnits ?? []).map((s) => ({
        tempKey: `existing-${s.id}`,
        existingId: s.id,
        name: s.name,
        perPurchase: s.perPurchase,
      })),
  );
  const [aliases, setAliases] = React.useState<AliasDraft[]>(() => {
    const tempKeyBySubUnitId = new Map<number, string>();
    for (const s of item?.subUnits ?? [])
      tempKeyBySubUnitId.set(s.id, `existing-${s.id}`);
    const defaultsByAliasLower = new Map<string, AliasUnitRef>();
    for (const d of item?.aliasUnitDefaults ?? []) {
      if (d.subUnitId != null) {
        const tempKey = tempKeyBySubUnitId.get(d.subUnitId);
        if (tempKey) {
          defaultsByAliasLower.set(d.aliasName.toLowerCase(), {
            kind: "subUnit",
            tempKey,
          });
        }
      } else if (d.unitId != null) {
        defaultsByAliasLower.set(d.aliasName.toLowerCase(), {
          kind: "unit",
          unitId: d.unitId,
          unitName: d.unitName,
        });
      }
    }
    return (item?.aliases ?? []).map((aliasName) => ({
      key: `existing-${aliasName}`,
      name: aliasName,
      defaultUnit: defaultsByAliasLower.get(aliasName.toLowerCase()) ?? null,
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
  const [purchaseUnit, setPurchaseUnit] = React.useState<{
    id: number;
    name: string;
  } | null>(
    item && item.purchaseUnitId && item.purchaseUnitName
      ? { id: item.purchaseUnitId, name: item.purchaseUnitName }
      : null,
  );
  // Canonical-name default unit/sub-unit — same picker model as alias
  // defaults. A sub-unit reference is held by tempKey so it survives renames.
  const [canonicalDefault, setCanonicalDefault] =
    React.useState<AliasUnitRef | null>(() => {
      if (item?.defaultSubUnitId != null) {
        const su = (item.subUnits ?? []).find(
          (s) => s.id === item.defaultSubUnitId,
        );
        if (su) return { kind: "subUnit", tempKey: `existing-${su.id}` };
      }
      if (item?.defaultUnitId != null && item?.defaultUnitName != null) {
        return {
          kind: "unit",
          unitId: item.defaultUnitId,
          unitName: item.defaultUnitName,
        };
      }
      return null;
    });
  const [excludeFromShoppingList, setExclude] = React.useState(
    item?.excludeFromShoppingList ?? false,
  );
  const [isEquipment, setIsEquipment] = React.useState(
    item?.isEquipment ?? false,
  );
  const [dietaryClass, setDietaryClass] = React.useState<
    "vegan" | "vegetarian" | "meat" | null
  >(item?.dietaryClass ?? null);

  // Stable reference for the per-row picker `search` callback. The list of
  // local sub-units is needed at search time; routing it through a ref keeps
  // SelectSearch's effect from re-firing on every parent render.
  const subUnitsRef = React.useRef(subUnits);
  React.useEffect(() => {
    subUnitsRef.current = subUnits;
  });

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

  React.useEffect(() => {
    const trimmedName = name.trim();
    const aliasNames = aliases.map((a) => a.name.trim()).filter((n) => n.length > 0);
    const valid = trimmedName.length > 0;
    const subUnitsPayload = subUnits
      .filter((su) => su.name.trim().length > 0)
      .map((su) => ({
        name: su.name.trim(),
        perPurchase:
          Number.isFinite(su.perPurchase) && su.perPurchase > 0
            ? su.perPurchase
            : 1,
      }));
    const subUnitIndexByTempKey = new Map<string, number>();
    {
      let idx = 0;
      for (const su of subUnits) {
        if (su.name.trim().length === 0) continue;
        subUnitIndexByTempKey.set(su.tempKey, idx);
        idx += 1;
      }
    }
    type AliasDefaultPayload = {
      aliasName: string;
      unitId: number | null;
      subUnitIndex: number | null;
    };
    const aliasUnitDefaultsPayload: AliasDefaultPayload[] = [];
    for (const alias of aliases) {
      const aliasName = alias.name.trim();
      if (aliasName.length === 0 || !alias.defaultUnit) continue;
      if (alias.defaultUnit.kind === "unit") {
        aliasUnitDefaultsPayload.push({
          aliasName,
          unitId: alias.defaultUnit.unitId,
          subUnitIndex: null,
        });
      } else {
        const subUnitIndex = subUnitIndexByTempKey.get(
          alias.defaultUnit.tempKey,
        );
        if (subUnitIndex == null) continue;
        aliasUnitDefaultsPayload.push({
          aliasName,
          unitId: null,
          subUnitIndex,
        });
      }
    }
    let defaultUnitId: number | null = null;
    let defaultSubUnitIndex: number | null = null;
    if (canonicalDefault) {
      if (canonicalDefault.kind === "unit") {
        defaultUnitId = canonicalDefault.unitId;
      } else {
        const idx = subUnitIndexByTempKey.get(canonicalDefault.tempKey);
        if (idx != null) defaultSubUnitIndex = idx;
      }
    }
    onPayloadChange(
      {
        name: trimmedName,
        aliases: aliasNames,
        aliasUnitDefaults: aliasUnitDefaultsPayload,
        subUnits: subUnitsPayload,
        defaultUnitId,
        defaultSubUnitIndex,
        defaultCategoryId: category?.id ?? null,
        purchaseUnitId: purchaseUnit?.id ?? null,
        excludeFromShoppingList,
        isEquipment,
        dietaryClass,
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
    subUnits,
    canonicalDefault,
    category,
    purchaseUnit,
    excludeFromShoppingList,
    isEquipment,
    dietaryClass,
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

  async function searchUnits(q: string) {
    const res = await fetch(`/api/v1/units?q=${encodeURIComponent(q)}`);
    if (!res.ok) return [];
    const body = (await res.json()) as {
      items: Array<{ id: number; name: string }>;
    };
    return body.items;
  }

  /**
   * Combined picker for the per-alias default: global units + this
   * ingredient's named sub-units, shown as a single ranked list. Sub-units
   * land first when the query is empty (they're the typical pick for a
   * compound-noun alias); both lists collapse to substring matches when the
   * user types.
   */
  const searchUnitsAndSubUnits = React.useCallback(
    async (q: string): Promise<SelectSearchItem[]> => {
      const lower = q.trim().toLowerCase();
      const localSubUnits = subUnitsRef.current
        .map((su, idx) => ({ su, idx }))
        .filter(({ su }) => su.name.trim().length > 0)
        .filter(
          ({ su }) =>
            lower.length === 0 || su.name.toLowerCase().includes(lower),
        )
        .map(({ su, idx }) => ({
          id: subUnitPickerId(idx),
          name: su.name,
        }));
      const globalUnits = await searchUnits(q);
      return [...localSubUnits, ...globalUnits];
    },
    [],
  );

  function addSubUnit() {
    setSubUnits((prev) => [
      ...prev,
      { tempKey: `new-${crypto.randomUUID()}`, name: "", perPurchase: 1 },
    ]);
  }

  function updateSubUnit(
    tempKey: string,
    partial: Partial<Pick<SubUnitDraft, "name" | "perPurchase">>,
  ) {
    setSubUnits((prev) =>
      prev.map((su) => (su.tempKey === tempKey ? { ...su, ...partial } : su)),
    );
  }

  function removeSubUnit(tempKey: string) {
    setSubUnits((prev) => prev.filter((su) => su.tempKey !== tempKey));
    // Clear any alias default that pointed at the removed sub-unit — silently
    // dropping it on save would surprise the user.
    setAliases((prev) =>
      prev.map((a) =>
        a.defaultUnit?.kind === "subUnit" && a.defaultUnit.tempKey === tempKey
          ? { ...a, defaultUnit: null }
          : a,
      ),
    );
    setCanonicalDefault((prev) =>
      prev?.kind === "subUnit" && prev.tempKey === tempKey ? null : prev,
    );
  }

  function addAlias() {
    setAliases((prev) => [
      ...prev,
      { key: `new-${crypto.randomUUID()}`, name: "", defaultUnit: null },
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

  /**
   * Translate the alias's stored default into the synthetic
   * `{id, name}` shape SelectSearch expects, picking up the current display
   * name of any sub-unit it references (so renames flow through).
   */
  function pickerValueFor(ref: AliasUnitRef | null): SelectSearchItem | null {
    if (!ref) return null;
    if (ref.kind === "unit")
      return { id: ref.unitId, name: ref.unitName };
    const idx = subUnits.findIndex((su) => su.tempKey === ref.tempKey);
    if (idx === -1) return null;
    return {
      id: subUnitPickerId(idx),
      name: subUnits[idx].name.trim() || "(unbenannt)",
    };
  }

  function onPickAliasDefault(
    aliasKey: string,
    picked: SelectSearchItem | null,
  ) {
    if (!picked) {
      updateAlias(aliasKey, { defaultUnit: null });
      return;
    }
    const subUnitIdx = decodeSubUnitIndex(picked.id);
    if (subUnitIdx !== null) {
      const su = subUnits[subUnitIdx];
      if (!su) return;
      updateAlias(aliasKey, {
        defaultUnit: { kind: "subUnit", tempKey: su.tempKey },
      });
      return;
    }
    updateAlias(aliasKey, {
      defaultUnit: {
        kind: "unit",
        unitId: picked.id,
        unitName: picked.name,
      },
    });
  }

  function onPickCanonicalDefault(picked: SelectSearchItem | null) {
    if (!picked) {
      setCanonicalDefault(null);
      return;
    }
    const subUnitIdx = decodeSubUnitIndex(picked.id);
    if (subUnitIdx !== null) {
      const su = subUnits[subUnitIdx];
      if (!su) return;
      setCanonicalDefault({ kind: "subUnit", tempKey: su.tempKey });
      return;
    }
    setCanonicalDefault({ kind: "unit", unitId: picked.id, unitName: picked.name });
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
        <Label>Einkaufseinheit</Label>
        <p className="text-xs text-[var(--color-muted-fg)]">
          Optional. Wird beim Aggregieren der Einkaufsliste als Zieleinheit
          verwendet — z.&nbsp;B. „Stück“ bei Knoblauch (so dass 12 Zehen → 2
          Stück werden).
        </p>
        <SelectSearch
          value={purchaseUnit}
          onChange={setPurchaseUnit}
          search={searchUnits}
          placeholder="Standard (Stück)"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Teil-Einheiten</Label>
        <p className="text-xs text-[var(--color-muted-fg)]">
          Optional. Untereinheiten dieser Zutat (z.&nbsp;B. „Zehe“ bei
          Knoblauch). Der Wert „pro Einkaufseinheit“ gibt an, wie viele
          Teil-Einheiten in einer Einkaufseinheit stecken — z.&nbsp;B. 10
          Zehen pro Knoblauchstück.
        </p>
        {subUnits.length > 0 ? (
          <ul className="flex flex-col divide-y divide-[var(--color-border)] overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)]">
            {subUnits.map((su) => (
              <li
                key={su.tempKey}
                className="grid grid-cols-[1fr_8rem_auto] items-center gap-2 px-3 py-2"
              >
                <Input
                  value={su.name}
                  onChange={(e) =>
                    updateSubUnit(su.tempKey, { name: e.target.value })
                  }
                  placeholder="z. B. Zehe"
                  aria-label="Name der Teil-Einheit"
                />
                <NumberInput
                  value={su.perPurchase}
                  onChange={(n) =>
                    updateSubUnit(su.tempKey, { perPurchase: n ?? 1 })
                  }
                  min={0.0001}
                  decimal
                  aria-label="pro Einkaufseinheit"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeSubUnit(su.tempKey)}
                  aria-label={`${su.name || "Teil-Einheit"} entfernen`}
                >
                  <X className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={addSubUnit}
        >
          <Plus className="size-4" /> Teil-Einheit hinzufügen
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Standard-Einheit des Namens</Label>
        <p className="text-xs text-[var(--color-muted-fg)]">
          Optional. Welche Einheit der Import annimmt, wenn die Zutat über
          ihren kanonischen Namen (ohne Alias) und ohne explizite Einheit
          erkannt wird — z.&nbsp;B. „Stäbchen“ bei Gemüsestäbchen. Ohne Default
          fällt der Import auf „Stück“ zurück.
        </p>
        <SelectSearch
          value={pickerValueFor(canonicalDefault)}
          onChange={onPickCanonicalDefault}
          search={searchUnitsAndSubUnits}
          placeholder="Default-Einheit…"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Aliase</Label>
        <p className="text-xs text-[var(--color-muted-fg)]">
          Alternative Namen für diese Zutat. Pro Alias lässt sich optional
          eine Standard-Einheit setzen — z.&nbsp;B. „Knoblauchzehe“ →
          „Zehe“, oder „Olivenöl extra virgin“ → „ml“. Ohne Default fällt
          der Import auf die globale Standard-Einheit „Stück“ zurück.
        </p>
        {aliases.length > 0 ? (
          <ul className="flex flex-col divide-y divide-[var(--color-border)] overflow-hidden rounded-[var(--radius)] border border-[var(--color-border)]">
            {aliases.map((alias) => (
              <li
                key={alias.key}
                className="grid grid-cols-[1fr_minmax(8rem,14rem)_auto] items-center gap-2 px-3 py-2"
              >
                <Input
                  value={alias.name}
                  onChange={(e) =>
                    updateAlias(alias.key, { name: e.target.value })
                  }
                  placeholder="Alias-Name"
                  aria-label="Alias-Name"
                />
                <SelectSearch
                  value={pickerValueFor(alias.defaultUnit)}
                  onChange={(picked) => onPickAliasDefault(alias.key, picked)}
                  search={searchUnitsAndSubUnits}
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
              </li>
            ))}
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

      {item && <ImpactSection entityKind="ingredient" id={item.id} />}
    </div>
  );
}
