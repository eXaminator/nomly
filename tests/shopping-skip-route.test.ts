import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-skip-route-"));
process.env.DATABASE_URL = join(tempDir, "test.db");

{
  const sqlite = new Database(process.env.DATABASE_URL);
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
  sqlite.close();
}

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

let itemId: number;
let storeId: number;

beforeEach(async () => {
  const { db } = await import("@/db");
  const s = await import("@/db/schema");
  db.delete(s.shoppingItemSkip).run();
  db.delete(s.shoppingItem).run();
  db.delete(s.ingredient).run();
  db.delete(s.supermarket).run();
  [{ id: storeId }] = db
    .insert(s.supermarket)
    .values({ name: "Edeka" })
    .returning({ id: s.supermarket.id })
    .all();
  const [ing] = db
    .insert(s.ingredient)
    .values({ name: "Milch" })
    .returning({ id: s.ingredient.id })
    .all();
  [{ id: itemId }] = db
    .insert(s.shoppingItem)
    .values({ ingredientId: ing.id })
    .returning({ id: s.shoppingItem.id })
    .all();
});

const ctx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

async function post(id: number | string, body: unknown): Promise<Response> {
  const { POST } = await import("@/app/api/v1/shopping/items/[id]/skip/route");
  return POST(
    new Request("http://localhost/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    ctx(id),
  );
}

async function del(id: number | string, query: string): Promise<Response> {
  const { DELETE } = await import("@/app/api/v1/shopping/items/[id]/skip/route");
  return DELETE(new Request(`http://localhost/x?${query}`, { method: "DELETE" }), ctx(id));
}

async function skips() {
  const { db } = await import("@/db");
  const { shoppingItemSkip } = await import("@/db/schema");
  return db.select().from(shoppingItemSkip).all();
}

describe("/api/v1/shopping/items/[id]/skip", () => {
  it("marks and lifts a skip", async () => {
    const res = await post(itemId, { supermarketId: storeId, on: "2026-10-22" });
    expect(res.status).toBe(200);
    expect(await skips()).toEqual([
      { shoppingItemId: itemId, supermarketId: storeId, skippedOn: "2026-10-22" },
    ]);
    const res2 = await del(itemId, `supermarketId=${storeId}`);
    expect(res2.status).toBe(200);
    expect(await skips()).toEqual([]);
  });

  it("rejects a malformed date or body with 400", async () => {
    expect((await post(itemId, { supermarketId: storeId, on: "22.10.2026" })).status).toBe(400);
    expect((await post(itemId, { supermarketId: storeId })).status).toBe(400);
    expect((await post(itemId, { supermarketId: storeId, on: "2026-10-22", x: 1 })).status).toBe(400);
    expect((await del(itemId, "")).status).toBe(400);
  });

  it("answers 404 for unknown items and stores", async () => {
    expect((await post(999_999, { supermarketId: storeId, on: "2026-10-22" })).status).toBe(404);
    expect((await post(itemId, { supermarketId: 999_999, on: "2026-10-22" })).status).toBe(404);
    expect((await post("abc", { supermarketId: storeId, on: "2026-10-22" })).status).toBe(404);
  });
});
