import { sql } from "drizzle-orm";
import { db } from "@/db";
import { category, ingredient, supermarket, unit } from "@/db/schema";

export type StandarddatenCounts = {
  units: number;
  categories: number;
  ingredients: number;
  supermarkets: number;
};

export function readStandarddatenCounts(): StandarddatenCounts {
  const c = <T extends { count: number }>(rows: T[]) => rows[0]?.count ?? 0;
  return {
    units: c(db.select({ count: sql<number>`count(*)` }).from(unit).all()),
    categories: c(db.select({ count: sql<number>`count(*)` }).from(category).all()),
    ingredients: c(db.select({ count: sql<number>`count(*)` }).from(ingredient).all()),
    supermarkets: c(db.select({ count: sql<number>`count(*)` }).from(supermarket).all()),
  };
}
