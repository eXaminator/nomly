"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { ImpactSection } from "../impact-section";
import type { EditFormProps } from "../list-shell";

export type TagItem = {
  id: number;
  name: string;
  recipeRefCount: number;
};

export function TagForm({ item, onPayloadChange }: EditFormProps<TagItem>) {
  const [name, setName] = React.useState(item?.name ?? "");

  React.useEffect(() => {
    const trimmed = name.trim();
    onPayloadChange({ name: trimmed }, trimmed.length > 0);
  }, [name, onPayloadChange]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="tag-name">Name</Label>
        <Input
          id="tag-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </div>

      {item && <ImpactSection entityKind="tag" id={item.id} />}
    </div>
  );
}
