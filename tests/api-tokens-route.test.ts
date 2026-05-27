import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-api-tokens-route-"));
process.env.DATABASE_URL = join(tempDir, "test.db");

{
  const sqlite = new Database(process.env.DATABASE_URL);
  const tmpDb = drizzle(sqlite);
  migrate(tmpDb, { migrationsFolder: "./drizzle" });
  sqlite.close();
}

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(async () => {
  const { db } = await import("@/db");
  const { apiToken } = await import("@/db/schema");
  db.delete(apiToken).run();
});

function postCreate(body: unknown): Promise<Response> {
  return import("@/app/api/v1/api-tokens/route").then(({ POST }) =>
    POST(
      new Request("http://localhost/api/v1/api-tokens", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    ),
  );
}

function getList(): Promise<Response> {
  return import("@/app/api/v1/api-tokens/route").then(({ GET }) => GET());
}

function del(id: string): Promise<Response> {
  return import("@/app/api/v1/api-tokens/[id]/route").then(({ DELETE }) =>
    DELETE(new Request("http://localhost/x", { method: "DELETE" }), {
      params: Promise.resolve({ id }),
    }),
  );
}

describe("POST /api/v1/api-tokens", () => {
  it("creates a token and returns the raw secret exactly once (201)", async () => {
    const res = await postCreate({ name: "home-assistant" });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.name).toBe("home-assistant");
    expect(typeof json.id).toBe("number");
    expect(typeof json.token).toBe("string");
    expect(json.token.length).toBeGreaterThan(20);

    // The secret is not retrievable afterwards via the list endpoint.
    const listJson = await (await getList()).json();
    expect(JSON.stringify(listJson)).not.toContain(json.token);
  });

  it("rejects a blank name with 400", async () => {
    const res = await postCreate({ name: "  " });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/api-tokens", () => {
  it("returns the tokens list", async () => {
    await postCreate({ name: "one" });
    const res = await getList();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.tokens).toHaveLength(1);
    expect(json.tokens[0].name).toBe("one");
  });
});

describe("DELETE /api/v1/api-tokens/[id]", () => {
  it("revokes an existing token (200) and verifyBearer then rejects it", async () => {
    const created = await (await postCreate({ name: "revoke-me" })).json();
    const res = await del(String(created.id));
    expect(res.status).toBe(200);

    const { verifyBearer } = await import("@/lib/bearer");
    expect(verifyBearer(created.token)).toBeNull();
  });

  it("returns 404 for an unknown id", async () => {
    const res = await del("999999");
    expect(res.status).toBe(404);
  });
});
