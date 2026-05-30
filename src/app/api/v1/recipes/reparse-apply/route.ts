import { NextResponse } from "next/server";
import { z } from "zod";
import { getRecipe, updateRecipe } from "@/lib/recipes/service";
import {
  buildReparsedRecipeInput,
  type ReparseReplacement,
} from "@/lib/recipes/reparse-scan";
import type { NewIngredientDefaults } from "@/lib/recipes/types";

const rowSchema = z.object({
  ingredientName: z.string().min(1),
  ingredientId: z.number().int().nullable().optional(),
  addAsAlias: z.boolean().optional(),
  unassigned: z.boolean().optional(),
  quantity: z.number().nullable(),
  unitId: z.number().int().nullable(),
  subUnitId: z.number().int().nullable(),
  displayUnit: z.string().nullable(),
  notes: z.string().nullable(),
  isOptional: z.boolean(),
  fixedAmount: z.boolean(),
  rawLine: z.string().nullable().optional(),
  isAlternative: z.boolean().optional(),
});

const defaultsSchema = z.object({
  name: z.string(),
  defaultCategoryId: z.number().int().nullable(),
  dietaryClass: z.enum(["vegan", "vegetarian", "meat"]).nullable(),
  excludeFromShoppingList: z.boolean(),
  isEquipment: z.boolean(),
});

const schema = z.object({
  recipes: z
    .array(
      z.object({
        recipeId: z.number().int().positive(),
        replacements: z
          .array(
            z.object({
              replaceRowIds: z.array(z.number().int()).min(1),
              rows: z.array(rowSchema),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
  newIngredientDefaults: z.array(defaultsSchema).optional(),
});

/**
 * Apply selected bulk re-parse changes. For each recipe, rebuild its
 * RecipeInput from the current state (substituting the selected line-groups
 * with the provided rows) and persist via the normal `updateRecipe` path — so
 * alternative links, sort order, new-ingredient creation, and downstream
 * shopping / meal-plan handling behave exactly like a normal edit. Recipes are
 * updated sequentially; a new ingredient name shared across recipes is created
 * by the first and resolved by name in the rest. Replacements whose row ids no
 * longer exist (recipe edited since the scan) are skipped and reported.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation" }, { status: 400 });
  }
  const newIngredientDefaults = parsed.data.newIngredientDefaults as
    | NewIngredientDefaults[]
    | undefined;

  let updatedRecipes = 0;
  let updatedGroups = 0;
  let skipped = 0;

  for (const r of parsed.data.recipes) {
    const view = getRecipe(r.recipeId);
    if (!view) {
      skipped += r.replacements.length;
      continue;
    }
    const { input, appliedGroups, skipped: sk } = buildReparsedRecipeInput(
      view,
      r.replacements as ReparseReplacement[],
    );
    skipped += sk;
    if (appliedGroups === 0) continue;
    updateRecipe(r.recipeId, { ...input, newIngredientDefaults });
    updatedRecipes += 1;
    updatedGroups += appliedGroups;
  }

  return NextResponse.json({ updatedRecipes, updatedGroups, skipped });
}
