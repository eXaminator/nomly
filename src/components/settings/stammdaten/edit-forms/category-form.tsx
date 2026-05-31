"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { AliasChipEditor } from "../alias-chip-editor";
import { ImpactSection } from "../impact-section";
import type { EditFormProps } from "../list-shell";

export type CategoryItem = {
  id: number;
  name: string;
  aliases: string[];
  usageCount: number;
};

export function CategoryForm({
  item,
  onPayloadChange,
}: EditFormProps<CategoryItem>) {
  const [name, setName] = React.useState(item?.name ?? "");
  const [aliases, setAliases] = React.useState<string[]>(item?.aliases ?? []);

  React.useEffect(() => {
    const trimmed = name.trim();
    onPayloadChange(
      {
        name: trimmed,
        aliases,
      },
      trimmed.length > 0,
    );
  }, [name, aliases, onPayloadChange]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="category-name">Name</Label>
        <Input
          id="category-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Aliase</Label>
        <AliasChipEditor value={aliases} onChange={setAliases} canonicalName={name} />
      </div>

      {item && <ImpactSection entityKind="category" id={item.id} />}
    </div>
  );
}
