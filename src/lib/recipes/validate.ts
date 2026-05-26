import { z } from "zod";

const ingredientSchema = z
  .object({
    ingredientName: z.string().min(1, "Zutat ist erforderlich"),
    ingredientId: z.number().int().positive().nullable().default(null),
    addAsAlias: z.boolean().default(false),
    quantity: z.number().nullable(),
    unitId: z.number().int().positive().nullable(),
    subUnitId: z.number().int().positive().nullable().default(null),
    displayUnit: z.string().nullable().default(null),
    notes: z.string().nullable(),
    isOptional: z.boolean().default(false),
    fixedAmount: z.boolean().default(false),
    rawLine: z.string().nullable().default(null),
    isAlternative: z.boolean().default(false),
  })
  .refine((v) => !(v.unitId != null && v.subUnitId != null), {
    message: "unitId und subUnitId schließen sich gegenseitig aus.",
    path: ["subUnitId"],
  });

const sectionSchema = z.object({
  title: z.string().nullable(),
  instructions: z.string(),
  ingredients: z.array(ingredientSchema),
});

const newIngredientDefaultsSchema = z.object({
  name: z.string().min(1),
  defaultCategoryId: z.number().int().positive().nullable(),
  dietaryClass: z.enum(["vegan", "vegetarian", "meat"]).nullable(),
  excludeFromShoppingList: z.boolean(),
  isEquipment: z.boolean().default(false),
});

export const recipeInputSchema = z.object({
  title: z.string().min(1, "Titel ist erforderlich"),
  description: z.string().nullable(),
  servings: z.number().int().positive(),
  prepTimeMin: z.number().int().nonnegative().nullable(),
  cookTimeMin: z.number().int().nonnegative().nullable(),
  sourceUrl: z.string().nullable(),
  photoPath: z.string().nullable(),
  /** Optional alternative to photoPath — server downloads and replaces. */
  photoUrl: z.string().nullable().optional(),
  tags: z.array(z.string()),
  sections: z.array(sectionSchema).min(1, "Mindestens einen Abschnitt anlegen"),
  newIngredientDefaults: z.array(newIngredientDefaultsSchema).optional(),
});

export type ValidatedRecipeInput = z.infer<typeof recipeInputSchema>;
