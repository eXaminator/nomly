"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectSearch } from "@/components/ui/select-search";

import { AliasChipEditor } from "../alias-chip-editor";
import { ImpactSection } from "../impact-section";
import type { EditFormProps } from "../list-shell";

export type ProductItem = {
  id: number;
  name: string;
  aliases: string[];
  defaultCategoryId: number | null;
  defaultCategoryName: string | null;
  shoppingItemRefCount: number;
};

export function ProductForm({
  item,
  onPayloadChange,
}: EditFormProps<ProductItem>) {
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

  React.useEffect(() => {
    const trimmed = name.trim();
    onPayloadChange(
      {
        name: trimmed,
        aliases,
        defaultCategoryId: category?.id ?? null,
      },
      trimmed.length > 0,
    );
  }, [name, aliases, category, onPayloadChange]);

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
        <Label htmlFor="product-name">Name</Label>
        <Input
          id="product-name"
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

      {item && <ImpactSection entityKind="product" id={item.id} />}
    </div>
  );
}
