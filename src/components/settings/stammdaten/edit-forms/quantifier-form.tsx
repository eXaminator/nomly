"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  TabCount,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

import { AliasChipEditor } from "../alias-chip-editor";
import {
  RecipeReferenceList,
  ReferencePane,
  useImpactData,
} from "../impact-section";
import type { EditFormProps } from "../list-shell";

export type QuantifierItem = {
  id: number;
  name: string;
  /** Numeric value; null = unspecified ("einige"). */
  value: number | null;
  aliases: string[];
  sortOrder: number;
  recipeRefCount: number;
};

export type QuantifierPayload = {
  name: string;
  value: number | null;
  aliases: string[];
  sortOrder: number;
};

/** Pure payload builder — exported for unit tests. */
export function buildQuantifierPayload(args: {
  name: string;
  valueText: string;
  aliases: string[];
  sortOrderText: string;
}): { payload: QuantifierPayload; valid: boolean } {
  const trimmedName = args.name.trim();
  const valueTrimmed = args.valueText.trim();
  const valueNum =
    valueTrimmed.length === 0 ? null : Number(valueTrimmed.replace(",", "."));
  const sortOrderTrimmed = args.sortOrderText.trim();
  const sortOrderNum =
    sortOrderTrimmed.length === 0
      ? 0
      : Number(sortOrderTrimmed.replace(",", "."));

  const valueValid =
    valueTrimmed.length === 0 || (Number.isFinite(valueNum) && valueNum != null);
  const sortOrderValid =
    sortOrderTrimmed.length === 0 || Number.isFinite(sortOrderNum);
  const valid = trimmedName.length > 0 && valueValid && sortOrderValid;

  return {
    payload: {
      name: trimmedName,
      value: valueValid && valueTrimmed.length > 0 ? valueNum : null,
      aliases: args.aliases,
      sortOrder: sortOrderValid ? sortOrderNum : 0,
    },
    valid,
  };
}

export function QuantifierForm({
  item,
  onPayloadChange,
}: EditFormProps<QuantifierItem>) {
  const [name, setName] = React.useState(item?.name ?? "");
  const [valueText, setValueText] = React.useState(
    item?.value != null ? String(item.value) : "",
  );
  const [aliases, setAliases] = React.useState<string[]>(item?.aliases ?? []);
  const [sortOrderText, setSortOrderText] = React.useState(
    item ? String(item.sortOrder) : "0",
  );
  const impact = useImpactData("quantifier", item?.id ?? -1, item != null);

  React.useEffect(() => {
    const { payload, valid } = buildQuantifierPayload({
      name,
      valueText,
      aliases,
      sortOrderText,
    });
    onPayloadChange(payload, valid);
  }, [name, valueText, aliases, sortOrderText, onPayloadChange]);

  const valueTrimmed = valueText.trim();
  const valueNum = Number(valueTrimmed.replace(",", "."));
  const valueInvalid = valueTrimmed.length > 0 && !Number.isFinite(valueNum);

  const fields = (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="quantifier-name">Name</Label>
        <Input
          id="quantifier-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="quantifier-value">Wert (optional)</Label>
        <Input
          id="quantifier-value"
          inputMode="decimal"
          value={valueText}
          onChange={(e) => setValueText(e.target.value)}
          placeholder="z. B. 1 — leer lassen für unbestimmt"
        />
        {valueInvalid ? (
          <p className="text-xs text-[var(--color-danger)]">
            Wert muss eine Zahl sein.
          </p>
        ) : (
          <p className="text-xs text-[var(--color-muted-fg)]">
            Numerischer Wert des Mengenworts (z.&nbsp;B. „ein&rdquo; = 1). Leer
            lassen für unbestimmte Mengen wie „einige&rdquo; oder „etwas&rdquo;.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label>Aliase</Label>
        <AliasChipEditor
          value={aliases}
          onChange={setAliases}
          canonicalName={name}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="quantifier-sortorder">Sortierung</Label>
        <Input
          id="quantifier-sortorder"
          inputMode="numeric"
          value={sortOrderText}
          onChange={(e) => setSortOrderText(e.target.value)}
        />
        <p className="text-xs text-[var(--color-muted-fg)]">
          Reihenfolge in Listen — kleinere Werte zuerst.
        </p>
      </div>
    </div>
  );

  // Create mode has no usage yet — render the fields bare.
  if (!item) return fields;

  const recipes = impact.data?.linkedRecipes ?? [];
  return (
    <Tabs defaultValue="stammdaten">
      <TabsList className="mb-4 flex-wrap">
        <TabsTrigger value="stammdaten">Stammdaten</TabsTrigger>
        <TabsTrigger value="rezepte">
          Rezepte
          {impact.data && <TabCount count={recipes.length} />}
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
    </Tabs>
  );
}
