import { NextResponse } from "next/server";
import { getTodayMealShoppingStatus } from "@/lib/shopping/today-meal-shopping";

/**
 * GET /api/v1/shopping/today-meal-status
 * What still needs buying for today's meals. The Home Assistant morning
 * reminder polls this at 9am and notifies only when `needsShopping` is true,
 * listing each meal, its unchecked-item count, and the shops that carry them.
 */
export function GET() {
  return NextResponse.json(getTodayMealShoppingStatus());
}
