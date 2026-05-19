import { z } from "zod";

const ingredientSchema = z.object({
  ingredientName: z.string().min(1, "Zutat ist erforderlich"),
  quantity: z.number().nullable(),
  unitId: z.number().int().positive().nullable(),
  notes: z.string().nullable(),
  isOptional: z.boolean().default(false),
});

const sectionSchema = z.object({
  title: z.string().nullable(),
  instructions: z.string(),
  ingredients: z.array(ingredientSchema),
});

export const recipeInputSchema = z.object({
  title: z.string().min(1, "Titel ist erforderlich"),
  description: z.string().nullable(),
  servings: z.number().int().positive(),
  prepTimeMin: z.number().int().nonnegative().nullable(),
  cookTimeMin: z.number().int().nonnegative().nullable(),
  sourceUrl: z.string().nullable(),
  photoPath: z.string().nullable(),
  tags: z.array(z.string()),
  sections: z.array(sectionSchema).min(1, "Mindestens einen Abschnitt anlegen"),
});

export type ValidatedRecipeInput = z.infer<typeof recipeInputSchema>;
