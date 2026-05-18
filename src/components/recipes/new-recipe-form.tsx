"use client";

import * as React from "react";
import { RecipeForm } from "./recipe-form";
import {
  UrlImportDialog,
  type ImportedRecipeResponse,
} from "./url-import-dialog";
import type { DraftRecipe } from "./types";

type Props = {
  tagSuggestions: string[];
};

function importedToDraft(imported: ImportedRecipeResponse): DraftRecipe {
  return {
    title: imported.title,
    description: imported.description ?? "",
    servings: String(imported.servings),
    prepTimeMin:
      imported.prepTimeMin === null ? "" : String(imported.prepTimeMin),
    cookTimeMin:
      imported.cookTimeMin === null ? "" : String(imported.cookTimeMin),
    sourceUrl: imported.sourceUrl,
    photoPath: imported.photoPath,
    tags: imported.tags,
    sections: imported.sections.map((s) => ({
      uid: crypto.randomUUID(),
      title: s.title ?? "",
      instructions: s.instructions,
      ingredients:
        s.ingredients.length === 0
          ? [
              {
                uid: crypto.randomUUID(),
                name: "",
                quantity: "",
                unit: null,
                notes: "",
              },
            ]
          : s.ingredients.map((i) => ({
              uid: crypto.randomUUID(),
              name: i.name,
              quantity: i.quantity === null ? "" : String(i.quantity),
              unit: i.unit ? { id: i.unit.id, name: i.unit.name } : null,
              notes: i.notes ?? "",
            })),
    })),
  };
}

export function NewRecipeForm({ tagSuggestions }: Props) {
  const [draftSeed, setDraftSeed] = React.useState<DraftRecipe | undefined>(
    undefined,
  );
  // Remount the form when we replace the seed so its internal useState picks
  // the new value as initial; controlled re-syncing across nested fields would
  // be fiddly.
  const [mountKey, setMountKey] = React.useState(0);

  function handleImported(recipe: ImportedRecipeResponse) {
    setDraftSeed(importedToDraft(recipe));
    setMountKey((k) => k + 1);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <UrlImportDialog onImported={handleImported} />
      </div>
      <RecipeForm
        key={mountKey}
        initial={draftSeed}
        tagSuggestions={tagSuggestions}
      />
    </div>
  );
}
