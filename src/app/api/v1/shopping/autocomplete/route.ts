import { NextResponse } from "next/server";
import { autocompleteItems } from "@/lib/shopping/items";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") ?? "";
  return NextResponse.json({ hits: autocompleteItems(q) });
}
