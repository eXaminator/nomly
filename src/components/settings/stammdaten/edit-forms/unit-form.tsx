"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectSearch } from "@/components/ui/select-search";

import { Switch } from "@/components/ui/switch";
import {
  TabCount,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

import { AliasChipEditor } from "../alias-chip-editor";
import {
  ConversionReferenceList,
  EntityReferenceList,
  RecipeReferenceList,
  ReferencePane,
  useImpactData,
} from "../impact-section";
import type { EditFormProps } from "../list-shell";

export type Dimension = "mass" | "volume" | "count";

export type UnitItem = {
  id: number;
  name: string;
  plural: string | null;
  aliases: string[];
  aliasPlurals: Record<string, string>;
  dimension: Dimension;
  baseUnitId: number | null;
  baseUnitName: string | null;
  factor: number;
  isContainer: boolean;
  recipeRefCount: number;
};

const DIMENSION_OPTIONS: Array<{ value: Dimension; label: string }> = [
  { value: "mass", label: "Masse" },
  { value: "volume", label: "Volumen" },
  { value: "count", label: "Stück" },
];

export function UnitForm({ item, onPayloadChange }: EditFormProps<UnitItem>) {
  const isEdit = item != null;

  const [name, setName] = React.useState(item?.name ?? "");
  const [plural, setPlural] = React.useState(item?.plural ?? "");
  const [aliases, setAliases] = React.useState<string[]>(item?.aliases ?? []);
  const [aliasPlurals, setAliasPlurals] = React.useState<Record<string, string>>(
    item?.aliasPlurals ?? {},
  );
  const [dimension, setDimension] = React.useState<Dimension>(
    item?.dimension ?? "mass",
  );
  const [baseUnit, setBaseUnit] = React.useState<{
    id: number;
    name: string;
  } | null>(
    item && item.baseUnitId != null && item.baseUnitName != null
      ? { id: item.baseUnitId, name: item.baseUnitName }
      : null,
  );
  const [factorText, setFactorText] = React.useState<string>(
    item ? String(item.factor) : "1",
  );
  const [isContainer, setIsContainer] = React.useState<boolean>(
    item?.isContainer ?? false,
  );
  const impact = useImpactData("unit", item?.id ?? -1, item != null);

  React.useEffect(() => {
    const trimmed = name.trim();
    const factor = Number(factorText.replace(",", "."));
    const valid =
      trimmed.length > 0 && Number.isFinite(factor) && factor > 0;
    // Only send plurals for aliases that still exist, trimmed.
    const aliasPluralsPayload: Record<string, string> = {};
    for (const a of aliases) {
      const v = aliasPlurals[a]?.trim();
      if (v) aliasPluralsPayload[a] = v;
    }
    onPayloadChange(
      {
        name: trimmed,
        plural: plural.trim() ? plural.trim() : null,
        aliases,
        aliasPlurals: aliasPluralsPayload,
        dimension,
        baseUnitId: baseUnit?.id ?? null,
        factor: Number.isFinite(factor) ? factor : 0,
        isContainer,
      },
      valid,
    );
  }, [
    name,
    plural,
    aliases,
    aliasPlurals,
    dimension,
    baseUnit,
    factorText,
    isContainer,
    onPayloadChange,
  ]);

  async function searchBaseUnits(q: string) {
    const res = await fetch(
      `/api/v1/units/manage?q=${encodeURIComponent(q)}`,
    );
    if (!res.ok) return [];
    const body = (await res.json()) as { items: UnitItem[] };
    return body.items
      .filter(
        (u) => u.dimension === dimension && (item == null || u.id !== item.id),
      )
      .map((u) => ({ id: u.id, name: u.name }));
  }

  const factorNum = Number(factorText.replace(",", "."));
  const factorInvalid =
    factorText.trim().length > 0 &&
    (!Number.isFinite(factorNum) || factorNum <= 0);

  const fields = (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="unit-name">Name</Label>
        <Input
          id="unit-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="unit-plural">Plural (optional)</Label>
        <Input
          id="unit-plural"
          value={plural}
          onChange={(e) => setPlural(e.target.value)}
          placeholder={name.trim() ? `z. B. ${name.trim()}…` : "z. B. Dosen"}
        />
        <p className="text-xs text-[var(--color-muted-fg)]">
          Wird beim Import zusätzlich erkannt und bei jeder Menge außer 1
          angezeigt. Leer lassen, wenn die Einheit keine Pluralform hat (g, ml,
          EL …).
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Aliase</Label>
        <AliasChipEditor value={aliases} onChange={setAliases} canonicalName={name} />
      </div>

      {aliases.length > 0 && (
        <div className="flex flex-col gap-2">
          <Label>Plural-Formen der Aliase (optional)</Label>
          <div className="flex flex-col gap-2">
            {aliases.map((alias) => (
              <div key={alias} className="grid grid-cols-[1fr_1fr] items-center gap-2">
                <span className="truncate text-sm text-[var(--color-muted-fg)]">
                  {alias}
                </span>
                <Input
                  aria-label={`Plural für ${alias}`}
                  value={aliasPlurals[alias] ?? ""}
                  placeholder="Plural"
                  onChange={(e) =>
                    setAliasPlurals((prev) => ({ ...prev, [alias]: e.target.value }))
                  }
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label>Dimension</Label>
        <div className="grid grid-cols-3 gap-2">
          {DIMENSION_OPTIONS.map((opt) => {
            const active = dimension === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={isEdit}
                onClick={() => {
                  if (isEdit) return;
                  if (dimension !== opt.value) setBaseUnit(null);
                  setDimension(opt.value);
                }}
                className={
                  "rounded-[var(--radius)] border px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 " +
                  (active
                    ? "border-[var(--color-accent)] bg-[color-mix(in_srgb,var(--color-accent),transparent_88%)] text-[var(--color-fg)]"
                    : "border-[var(--color-border)] hover:bg-[var(--color-muted)]")
                }
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        {isEdit && (
          <p className="text-xs text-[var(--color-muted-fg)]">
            Die Dimension einer Einheit kann nach der Anlage nicht mehr
            geändert werden.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label>Basis-Einheit</Label>
        <SelectSearch
          value={baseUnit}
          onChange={setBaseUnit}
          search={searchBaseUnits}
          placeholder="Keine — diese Einheit ist die Basis"
        />
        <p className="text-xs text-[var(--color-muted-fg)]">
          Optional. Nur Einheiten der gleichen Dimension können als Basis
          dienen.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="unit-factor">Faktor</Label>
        <Input
          id="unit-factor"
          inputMode="decimal"
          value={factorText}
          onChange={(e) => setFactorText(e.target.value)}
        />
        {factorInvalid ? (
          <p className="text-xs text-[var(--color-danger)]">
            Faktor muss eine positive Zahl sein.
          </p>
        ) : (
          <p className="text-xs text-[var(--color-muted-fg)]">
            1 {name.trim() || "Einheit"} ={" "}
            {Number.isFinite(factorNum) && factorNum > 0 ? factorNum : "?"}{" "}
            {baseUnit?.name ?? "Basis-Einheiten"}.
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <div>
          <Label>Behälter</Label>
          <p className="text-xs text-[var(--color-muted-fg)]">
            Aktivieren für Einheiten, die ein physisches Gefäß beschreiben
            (Dose, Glas, Tube …). Der Parser hält dann nachfolgende
            Adjektive als Teil des Produktnamens (z.&nbsp;B. „1 Dose chopped
            tomatoes&rdquo;).
          </p>
        </div>
        <Switch
          checked={isContainer}
          onCheckedChange={(v) => setIsContainer(Boolean(v))}
        />
      </div>
    </div>
  );

  // Create mode has no usage yet — render the fields bare.
  if (!item) return fields;

  const recipes = impact.data?.linkedRecipes ?? [];
  const conversionArticles = impact.data?.linkedIngredients ?? [];
  const derivedUnits = impact.data?.linkedDerivedUnits ?? [];
  return (
    <Tabs defaultValue="stammdaten">
      <TabsList className="mb-4 flex-wrap">
        <TabsTrigger value="stammdaten">Stammdaten</TabsTrigger>
        <TabsTrigger value="rezepte">
          Rezepte
          {impact.data && <TabCount count={recipes.length} />}
        </TabsTrigger>
        <TabsTrigger value="artikel">
          Artikel
          {impact.data && <TabCount count={conversionArticles.length} />}
        </TabsTrigger>
        <TabsTrigger value="einheiten">
          Einheiten
          {impact.data && <TabCount count={derivedUnits.length} />}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="stammdaten">{fields}</TabsContent>
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
      <TabsContent value="artikel">
        <ReferencePane
          loading={impact.loading}
          error={impact.error}
          isEmpty={conversionArticles.length === 0}
          emptyText="Keine Artikel mit Umrechnungen über diese Einheit."
        >
          <ConversionReferenceList items={conversionArticles} />
        </ReferencePane>
      </TabsContent>
      <TabsContent value="einheiten">
        <ReferencePane
          loading={impact.loading}
          error={impact.error}
          isEmpty={derivedUnits.length === 0}
          emptyText="Keine Einheit nutzt diese als Basis."
        >
          <EntityReferenceList
            items={derivedUnits}
            editHref={(id) => `/einstellungen/einheiten?edit=${id}`}
          />
        </ReferencePane>
      </TabsContent>
    </Tabs>
  );
}
