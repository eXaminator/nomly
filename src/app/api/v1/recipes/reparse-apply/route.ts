import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { getRecipe, updateRecipeTx } from "@/lib/recipes/service";
import {
  buildReparsedRecipeInput,
  type ReparseReplacement,
} from "@/lib/recipes/reparse-scan";
import type {
  AliasWarning,
  NewIngredientDefaults,
  RecipeInput,
} from "@/lib/recipes/types";
import { newIngredientDefaultsSchema } from "@/lib/stammdaten/ingredient/schema";

const rowSchema = z.object({
  ingredientName: z.string().min(1),
  ingredientId: z.number().int().nullable().optional(),
  addAsAlias: z.boolean().optional(),
  unassigned: z.boolean().optional(),
  quantity: z.number().nullable(),
  quantityLow: z.number().nullable().optional(),
  unitId: z.number().int().nullable(),
  displayUnit: z.string().nullable(),
  notes: z.string().nullable(),
  isOptional: z.boolean(),
  fixedAmount: z.boolean(),
  rawLine: z.string().nullable().optional(),
  isAlternative: z.boolean().optional(),
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
  newIngredientDefaults: z.array(newIngredientDefaultsSchema).optional(),
});

/**
 * Apply selected bulk re-parse changes — all or nothing. For each recipe,
 * rebuild its RecipeInput from the current state (substituting the selected
 * line-groups with the provided rows) and persist via the normal
 * `updateRecipeTx` path — so alternative links, sort order, new-ingredient
 * creation, and downstream shopping / meal-plan handling behave exactly like
 * a normal edit. A new ingredient name shared across recipes is created by
 * the first and resolved by name in the rest.
 *
 * Nothing is dropped silently:
 * - Replacements whose row ids no longer exist (recipe edited since the
 *   scan) fail the WHOLE request with 409 + the stale groups, before any
 *   write — stale lines can never succeed on retry, and partial application
 *   would invalidate the client's remaining row ids.
 * - All updates run in ONE transaction; any error rolls the whole batch
 *   back (500), so the client's dialog state stays valid for a retry.
 * - Alias requests that hit a name conflict are reported as
 *   `aliasWarnings` instead of being silently skipped.
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

  // Pass 1 — read-only: resolve every recipe and detect stale groups.
  const stale: { recipeId: number; replaceRowIds: number[] }[] = [];
  const prepared: { recipeId: number; input: RecipeInput; groups: number }[] = [];
  for (const r of parsed.data.recipes) {
    const view = getRecipe(r.recipeId);
    if (!view) {
      for (const rep of r.replacements) {
        stale.push({ recipeId: r.recipeId, replaceRowIds: rep.replaceRowIds });
      }
      continue;
    }
    // Mirror buildReparsedRecipeInput's matching: a group applies when ANY
    // of its row ids is still present.
    const presentIds = new Set(
      view.sections.flatMap((s) => s.ingredients.map((i) => i.id)),
    );
    const staleReps = r.replacements.filter(
      (rep) => !rep.replaceRowIds.some((id) => presentIds.has(id)),
    );
    if (staleReps.length > 0) {
      for (const rep of staleReps) {
        stale.push({ recipeId: r.recipeId, replaceRowIds: rep.replaceRowIds });
      }
      continue;
    }
    const { input, appliedGroups } = buildReparsedRecipeInput(
      view,
      r.replacements as ReparseReplacement[],
    );
    prepared.push({ recipeId: r.recipeId, input, groups: appliedGroups });
  }
  if (stale.length > 0) {
    return NextResponse.json({ error: "stale", stale }, { status: 409 });
  }

  // Pass 2 — one transaction over the whole batch.
  let updatedGroups = 0;
  const aliasWarnings: AliasWarning[] = [];
  try {
    db.transaction((tx) => {
      for (const p of prepared) {
        const result = updateRecipeTx(tx, p.recipeId, {
          ...p.input,
          newIngredientDefaults,
        });
        aliasWarnings.push(...result.aliasWarnings);
        updatedGroups += p.groups;
      }
    });
  } catch (err) {
    console.error("reparse-apply failed; batch rolled back", err);
    return NextResponse.json({ error: "apply" }, { status: 500 });
  }

  return NextResponse.json({
    updatedRecipes: prepared.length,
    updatedGroups,
    aliasWarnings,
  });
}
