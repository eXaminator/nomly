import { NextResponse } from "next/server";
import { clearAllItems, listShoppingItems } from "@/lib/shopping/items";
import { publishShoppingChanged } from "@/lib/shopping/realtime";

export async function GET() {
  return NextResponse.json({ items: listShoppingItems() });
}

export async function DELETE() {
  const result = clearAllItems();
  publishShoppingChanged();
  return NextResponse.json(result);
}
