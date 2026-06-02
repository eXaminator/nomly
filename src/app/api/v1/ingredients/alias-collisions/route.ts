import { NextResponse } from "next/server";

import { findCrossIngredientAliasCollisions } from "@/lib/stammdaten/ingredient/alias-collisions";

/**
 * Advisory lookup for the ingredient editor: which OTHER ingredients already
 * use a given (alias) name, and with what unit. Non-blocking — duplicate
 * aliases are allowed and disambiguated by unit at match time.
 *
 * GET /api/v1/ingredients/alias-collisions?name=tomatoes&excludeId=123
 */
export function GET(request: Request) {
  const url = new URL(request.url);
  const name = url.searchParams.get("name") ?? "";
  const excludeRaw = url.searchParams.get("excludeId");
  const excludeId = excludeRaw ? Number.parseInt(excludeRaw, 10) : undefined;
  const collisions = findCrossIngredientAliasCollisions(
    name,
    Number.isFinite(excludeId) ? excludeId : undefined,
  );
  return NextResponse.json({ collisions });
}
