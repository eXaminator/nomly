import type { ComboboxItem } from "@/components/ui/combobox";

/**
 * Per-row state surfaced after a URL import: what matched, what didn't,
 * what we defaulted. The form renders small badges off these flags so the
 * user can see at a glance which rows need attention. Cleared as soon as
 * the user edits the relevant field (handled in `IngredientRow`).
 */
export type ImportAnnotation = {
  /** True when the ingredient name didn't match any existing row — it'll be
   *  created when the recipe is saved. */
  ingredientIsNew: boolean;
  /** "ok" — the unit resolved cleanly via the alias table.
   *  "synonym" — resolved via the import synonym map (e.g. tablespoon→EL).
   *  "defaulted" — no unit was parsed; we defaulted to Stück.
   *  "unresolved" — a unit token was parsed but didn't resolve.
   *  "empty" — no quantity, no unit. */
  unitState: "ok" | "synonym" | "defaulted" | "unresolved" | "empty";
  /** The non-canonical unit token that the importer saw, when it differs
   *  from the resolved canonical (synonym match) or couldn't be resolved
   *  at all (unresolved). Null for direct matches and defaulted rows. */
  rawUnit: string | null;
};

export type DraftIngredient = {
  uid: string;
  /** Freeform name — resolved server-side to an existing ingredient by
   *  case-insensitive canonical/alias match, or auto-created on save. */
  name: string;
  /** Canonical ingredient name (the row that `name` resolves to via alias).
   *  Populated when loading an existing recipe or after an alias match in
   *  autocomplete; shown as a small pill under the input when it differs
   *  from `name`. Cleared as soon as the user edits the field. */
  canonicalName: string | null;
  quantity: string;
  unit: ComboboxItem | null;
  notes: string;
  importAnnotation?: ImportAnnotation;
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
    name: "",
    canonicalName: null,
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
            name: "",
            canonicalName: null,
            quantity: "",
            unit: null,
            notes: "",
          },
        ],
      },
    ],
  };
}
