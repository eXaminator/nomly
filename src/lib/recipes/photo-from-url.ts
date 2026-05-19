import { fetchUrl, FetchError } from "../recipe-import/fetch.ts";
import { savePhotoBuffer } from "../photos.ts";
import type { ValidatedRecipeInput } from "./validate.ts";
import type { RecipeInput } from "./types.ts";

/**
 * When the payload carries a `photoUrl`, download the image and replace the
 * caller's `photoPath` with the freshly-stored path. The returned shape is
 * the plain `RecipeInput` the service layer expects (no `photoUrl`).
 *
 * Throws a `PhotoUrlError` on fetch/decode failure so the API route can
 * return a 422 — failing the recipe save is preferable to silently saving
 * without the photo the user explicitly attached.
 */
export class PhotoUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhotoUrlError";
  }
}

export async function resolvePhotoFromInput(
  input: ValidatedRecipeInput,
): Promise<RecipeInput> {
  const { photoUrl, ...rest } = input;
  const trimmed = photoUrl?.trim();
  if (!trimmed) {
    return { ...rest, photoPath: rest.photoPath ?? null };
  }
  try {
    const result = await fetchUrl(trimmed, {
      accept: "image/*",
      timeoutMs: 20_000,
      maxBytes: 15 * 1024 * 1024,
    });
    const path = await savePhotoBuffer(result.body);
    return { ...rest, photoPath: path };
  } catch (e) {
    if (e instanceof FetchError) {
      throw new PhotoUrlError(`Foto-URL konnte nicht geladen werden: ${e.message}`);
    }
    // sharp / decode error
    throw new PhotoUrlError(
      e instanceof Error ? `Foto-URL ungültig: ${e.message}` : "Foto-URL ungültig.",
    );
  }
}
