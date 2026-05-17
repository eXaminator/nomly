import { NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { db } from "@/db";
import { tag } from "@/db/schema";

export function GET() {
  const tags = db.select().from(tag).orderBy(asc(tag.name)).all();
  return NextResponse.json({ tags: tags.map((t) => t.name) });
}
