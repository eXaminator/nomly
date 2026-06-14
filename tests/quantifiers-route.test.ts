import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-quantifiers-route-"));
process.env.DATABASE_URL = join(tempDir, "test.db");

{
  const sqlite = new Database(process.env.DATABASE_URL);
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
  sqlite.close();
}

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(async () => {
  const { db } = await import("@/db");
  const { quantifier, quantifierAlias } = await import("@/db/schema");
  db.delete(quantifierAlias).run();
  db.delete(quantifier).run();
});

function getList(): Promise<Response> {
  return import("@/app/api/v1/quantifiers/route").then(({ GET }) => GET());
}

describe("GET /api/v1/quantifiers", () => {
  it("returns each quantifier with its value and aliases", async () => {
    const { db } = await import("@/db");
    const { quantifier, quantifierAlias } = await import("@/db/schema");

    const [zwei] = db
      .insert(quantifier)
      .values({ name: "zwei", value: 2, sortOrder: 0 })
      .returning({ id: quantifier.id })
      .all();
    const [einige] = db
      .insert(quantifier)
      .values({ name: "einige", value: null, sortOrder: 1 })
      .returning({ id: quantifier.id })
      .all();
    db.insert(quantifierAlias).values({ quantifierId: zwei.id, name: "two" }).run();
    db
      .insert(quantifierAlias)
      .values({ quantifierId: einige.id, name: "several" })
      .run();

    const res = await getList();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: { id: number; name: string; value: number | null; aliases: string[] }[];
    };

    const byName = new Map(body.items.map((q) => [q.name, q]));
    expect(byName.get("zwei")).toMatchObject({ id: zwei.id, value: 2 });
    expect(byName.get("zwei")!.aliases).toContain("two");
    expect(byName.get("einige")).toMatchObject({ id: einige.id, value: null });
    expect(byName.get("einige")!.aliases).toContain("several");
  });

  it("returns an empty aliases array for a quantifier with no aliases", async () => {
    const { db } = await import("@/db");
    const { quantifier } = await import("@/db/schema");
    db.insert(quantifier).values({ name: "mehrere", value: null, sortOrder: 0 }).run();

    const res = await getList();
    const body = (await res.json()) as {
      items: { name: string; aliases: string[] }[];
    };
    const mehrere = body.items.find((q) => q.name === "mehrere");
    expect(mehrere).toBeDefined();
    expect(mehrere!.aliases).toEqual([]);
  });
});
