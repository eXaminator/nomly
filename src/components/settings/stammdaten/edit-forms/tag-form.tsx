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

import {
  RecipeReferenceList,
  ReferencePane,
  useImpactData,
} from "../impact-section";
import type { EditFormProps } from "../list-shell";

export type TagItem = {
  id: number;
  name: string;
  recipeRefCount: number;
};

export function TagForm({ item, onPayloadChange }: EditFormProps<TagItem>) {
  const [name, setName] = React.useState(item?.name ?? "");
  const impact = useImpactData("tag", item?.id ?? -1, item != null);

  React.useEffect(() => {
    const trimmed = name.trim();
    onPayloadChange({ name: trimmed }, trimmed.length > 0);
  }, [name, onPayloadChange]);

  const fields = (
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
    </div>
  );

  // Create mode has no usage yet — render the field bare.
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
