"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectSearch } from "@/components/ui/select-search";
import { Switch } from "@/components/ui/switch";

import { AliasChipEditor } from "../alias-chip-editor";
import { ImpactSection } from "../impact-section";
import type { EditFormProps } from "../list-shell";

export type IngredientItem = {
  id: number;
  name: string;
  aliases: string[];
  defaultCategoryId: number | null;
  defaultCategoryName: string | null;
  excludeFromShoppingList: boolean;
  dietaryClass: "vegan" | "vegetarian" | "meat" | null;
  recipeRefCount: number;
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
  const [aliases, setAliases] = React.useState<string[]>(item?.aliases ?? []);
  const [category, setCategory] = React.useState<{
    id: number;
    name: string;
  } | null>(
    item && item.defaultCategoryId && item.defaultCategoryName
      ? { id: item.defaultCategoryId, name: item.defaultCategoryName }
      : null,
  );
  const [excludeFromShoppingList, setExclude] = React.useState(
    item?.excludeFromShoppingList ?? false,
  );
  const [dietaryClass, setDietaryClass] = React.useState<
    "vegan" | "vegetarian" | "meat" | null
  >(item?.dietaryClass ?? null);

  React.useEffect(() => {
    const trimmed = name.trim();
    const valid = trimmed.length > 0;
    onPayloadChange(
      {
        name: trimmed,
        aliases,
        defaultCategoryId: category?.id ?? null,
        excludeFromShoppingList,
        dietaryClass,
      },
      valid,
    );
  }, [
    name,
    aliases,
    category,
    excludeFromShoppingList,
    dietaryClass,
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
        <Label>Aliase</Label>
        <AliasChipEditor value={aliases} onChange={setAliases} />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Default-Kategorie</Label>
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
            Bei aktivierter Option wird die Zutat nicht in die Einkaufsliste
            übernommen.
          </p>
        </div>
        <Switch
          checked={excludeFromShoppingList}
          onCheckedChange={(v) => setExclude(Boolean(v))}
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

      {item && (
        <ImpactSection entityKind="ingredient" id={item.id} />
      )}
    </div>
  );
}
