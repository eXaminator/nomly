import { NextResponse } from "next/server";
import { getStoreAvailability } from "@/lib/shopping/store-availability";

/**
 * GET /api/v1/shopping/store-availability
 * Per-store count of still-needed items. The Home Assistant geofence
 * automation notifies only when the arrived-at store's `neededCount > 0`.
 */
export function GET() {
  return NextResponse.json({ supermarkets: getStoreAvailability() });
}
