"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectSearch } from "@/components/ui/select-search";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  TabCount,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

import { DefaultUnitField } from "@/components/ingredients/article-fields/default-unit-field";
import { ExcludedSupermarketsField } from "@/components/ingredients/article-fields/excluded-supermarkets-field";
import { ConversionsEditor } from "@/components/ingredients/article-fields/conversions-editor";
import { AliasesEditor } from "@/components/ingredients/article-fields/aliases-editor";
import {
  CrossCollisionNote,
  useCrossIngredientCollisions,
} from "@/components/ingredients/article-fields/cross-collisions";
import {
  aliasDraftsFromItem,
  aliasesToPayload,
  conversionDraftsFromItem,
  conversionsToPayload,
  type AliasDraft,
  type ConversionDraft,
} from "@/components/ingredients/article-fields/types";

import {
  RecipeReferenceList,
  ReferencePane,
  useImpactData,
} from "../impact-section";
import { computeRenamePairs } from "../rename-pairs";
import type { EditFormProps } from "../list-shell";
import {
  formatAverageInterval,
  formatLastPurchasedRelative,
  formatPurchaseDate,
} from "@/lib/ingredients/purchase-stats-format";

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
  /** Buying cadence derived from recorded purchases (check-offs). */
  purchaseStats: {
    lastPurchasedAt: number | null;
    purchaseCount: number;
    averageIntervalDays: number | null;
  };
};

const DIET_OPTIONS = [
  { value: "vegan", label: "Vegan" },
  { value: "vegetarian", label: "Vegetarisch" },
  { value: "meat", label: "Tierisch" },
] as const;

export function IngredientForm({
  item,
  onPayloadChange,
}: EditFormProps<IngredientItem>) {
  const [name, setName] = React.useState(item?.name ?? "");
  const [conversions, setConversions] = React.useState<ConversionDraft[]>(() =>
    conversionDraftsFromItem(item?.conversions ?? []),
  );
  const [aliases, setAliases] = React.useState<AliasDraft[]>(() =>
    aliasDraftsFromItem(
      item?.aliases ?? [],
      item?.aliasUnitDefaults ?? [],
      item?.aliasDisplayNames ?? {},
    ),
  );
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
  const impact = useImpactData("ingredient", item?.id ?? -1, item != null);

  // Renames the user made to the canonical name or to EXISTING aliases —
  // used to offer propagating the change into existing recipes' display
  // names. Swaps (promote alias to name) produce no pairs: both spellings
  // still exist on the article. See computeRenamePairs.
  const renamePairs = React.useMemo(
    () =>
      item
        ? computeRenamePairs({ originalName: item.name, name, aliases })
        : [],
    [item, name, aliases],
  );

  // Cross-ingredient collisions for the canonical name + every alias — an
  // advisory note (the line's unit disambiguates at match time).
  const crossCollisions = useCrossIngredientCollisions(
    [name, ...aliases.map((a) => a.name)],
    item?.id ?? undefined,
  );

  React.useEffect(() => {
    const trimmedName = name.trim();
    const valid = trimmedName.length > 0;
    const { aliases: aliasNames, aliasUnitDefaults, aliasDisplayNames } =
      aliasesToPayload(aliases);
    onPayloadChange(
      {
        name: trimmedName,
        aliases: aliasNames,
        aliasUnitDefaults,
        aliasDisplayNames,
        conversions: conversionsToPayload(conversions),
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

  /**
   * Promotes an alias to the canonical name by swapping the two roles in the
   * draft: the alias becomes the name (taking its default unit along as the
   * canonical default), the previous name becomes the alias with the previous
   * canonical default unit. The alias's Anzeigename stays on the row, where
   * it remains visible and editable. Nothing persists until "Speichern".
   */
  function swapAliasWithName(key: string) {
    const target = aliases.find((a) => a.key === key);
    if (!target) return;
    const promotedName = target.name.trim();
    const demotedName = name.trim();
    if (promotedName.length === 0 || demotedName.length === 0) return;
    setAliases((prev) =>
      prev.map((a) =>
        a.key === key
          ? { ...a, name: demotedName, defaultUnit: canonicalDefault }
          : a,
      ),
    );
    setName(promotedName);
    setCanonicalDefault(target.defaultUnit);
  }

  const stammdatenContent = (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="ingredient-name">Name</Label>
        <Input
          id="ingredient-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
        <CrossCollisionNote
          hits={crossCollisions.get(name.trim().toLowerCase())}
        />
      </div>

      <DefaultUnitField value={canonicalDefault} onChange={setCanonicalDefault} />

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

      <ExcludedSupermarketsField
        value={excludedSupermarkets}
        onChange={setExcludedSupermarkets}
      />

      {item ? <PurchaseStatsPanel stats={item.purchaseStats} /> : null}
    </div>
  );

  const renameFooter =
    renamePairs.length > 0 ? (
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
            {renamePairs.map((p) => `„${p.from}“ → „${p.to}“`).join(", ")}
            . Sonst bleiben bestehende Rezepte unverändert.
          </span>
        </span>
      </label>
    ) : null;

  const recipes = impact.data?.linkedRecipes ?? [];
  return (
    <Tabs defaultValue="stammdaten">
      <TabsList className="mb-4 flex-wrap">
        <TabsTrigger value="stammdaten">Stammdaten</TabsTrigger>
        <TabsTrigger value="umrechnungen">
          Umrechnungen
          <TabCount count={conversions.length} />
        </TabsTrigger>
        <TabsTrigger value="aliase">
          Aliase
          <TabCount count={aliases.length} />
        </TabsTrigger>
        {item ? (
          <TabsTrigger value="rezepte">
            Rezepte
            {impact.data && <TabCount count={recipes.length} />}
          </TabsTrigger>
        ) : null}
      </TabsList>
      <TabsContent value="stammdaten">{stammdatenContent}</TabsContent>
      <TabsContent value="umrechnungen">
        <ConversionsEditor value={conversions} onChange={setConversions} />
      </TabsContent>
      <TabsContent value="aliase">
        <AliasesEditor
          value={aliases}
          onChange={setAliases}
          name={name}
          crossCollisions={crossCollisions}
          onSwapWithName={swapAliasWithName}
          footer={renameFooter}
        />
      </TabsContent>
      {item ? (
        <TabsContent value="rezepte">
          <ReferencePane
            loading={impact.loading}
            error={impact.error}
            isEmpty={recipes.length === 0}
            emptyText="Wird in keinem Rezept verwendet."
          >
            <RecipeReferenceList recipes={recipes} />
          </ReferencePane>
        </TabsContent>
      ) : null}
    </Tabs>
  );
}

/**
 * Read-only "Einkaufsstatistik" panel shown in the ingredient detail drawer.
 * Surfaces when the article was last bought (checked off on a shopping list)
 * and — once at least three purchases are on record — the average buying
 * interval. Nothing is shown for never-bought articles beyond a hint.
 */
function PurchaseStatsPanel({
  stats,
}: {
  stats: IngredientItem["purchaseStats"];
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>Einkaufsstatistik</Label>
      {stats.lastPurchasedAt == null ? (
        <p className="text-xs text-[var(--color-muted-fg)]">
          Noch nie eingekauft. Sobald der Artikel auf einer Einkaufsliste
          abgehakt wird, erscheint hier, wann er zuletzt gekauft wurde.
        </p>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-[var(--color-muted-fg)]">Zuletzt gekauft</dt>
          <dd>
            {formatPurchaseDate(stats.lastPurchasedAt)}{" "}
            <span className="text-[var(--color-muted-fg)]">
              ({formatLastPurchasedRelative(stats.lastPurchasedAt)})
            </span>
          </dd>
          <dt className="text-[var(--color-muted-fg)]">Gekauft</dt>
          <dd>{stats.purchaseCount}×</dd>
          {stats.averageIntervalDays != null ? (
            <>
              <dt className="text-[var(--color-muted-fg)]">Im Schnitt</dt>
              <dd>{formatAverageInterval(stats.averageIntervalDays)}</dd>
            </>
          ) : null}
        </dl>
      )}
    </div>
  );
}
