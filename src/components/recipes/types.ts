import type { ComboboxItem } from "@/components/ui/combobox";

export type DraftIngredient = {
  uid: string;
  ingredient: ComboboxItem | null;
  quantity: string;
  unit: ComboboxItem | null;
  notes: string;
};

export type DraftSection = {
  uid: string;
  title: string;
  instructions: string;
  ingredients: DraftIngredient[];
};

export type DraftRecipe = {
  title: string;
  description: string;
  servings: string;
  prepTimeMin: string;
  cookTimeMin: string;
  sourceUrl: string;
  photoPath: string | null;
  tags: string[];
  sections: DraftSection[];
};

export function emptyIngredient(): DraftIngredient {
  return {
    uid: crypto.randomUUID(),
    ingredient: null,
    quantity: "",
    unit: null,
    notes: "",
  };
}

export function emptySection(): DraftSection {
  return {
    uid: crypto.randomUUID(),
    title: "",
    instructions: "",
    ingredients: [emptyIngredient()],
  };
}

/**
 * Initial state for the "neues Rezept" form. Uses deterministic UIDs so
 * server-rendered HTML and the first client render produce the same htmlFor /
 * id attributes — random UUIDs would diverge and abort React hydration,
 * silently breaking every event handler in the form (including
 * `Abschnitt hinzufügen` and `PhotoUpload`'s file picker). Items the user
 * adds at runtime stay on `crypto.randomUUID()` because those callsites only
 * fire client-side.
 */
export function emptyRecipe(): DraftRecipe {
  return {
    title: "",
    description: "",
    servings: "4",
    prepTimeMin: "",
    cookTimeMin: "",
    sourceUrl: "",
    photoPath: null,
    tags: [],
    sections: [
      {
        uid: "initial-section",
        title: "",
        instructions: "",
        ingredients: [
          {
            uid: "initial-ingredient",
            ingredient: null,
            quantity: "",
            unit: null,
            notes: "",
          },
        ],
      },
    ],
  };
}
