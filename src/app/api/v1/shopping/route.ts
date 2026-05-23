import { NextResponse } from "next/server";
import { clearAllItems, listShoppingItems } from "@/lib/shopping/items";

export async function GET() {
  return NextResponse.json({ items: listShoppingItems() });
}

export async function DELETE() {
  const result = clearAllItems();
  return NextResponse.json(result);
}
