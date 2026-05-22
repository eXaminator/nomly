import { NextResponse } from "next/server";
import { listShoppingItems } from "@/lib/shopping/items";

export async function GET() {
  return NextResponse.json({ items: listShoppingItems() });
}
