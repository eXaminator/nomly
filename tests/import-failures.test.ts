import { describe, it, expect, afterAll, beforeAll, beforeEach, vi } from "vitest";

// The URL importer itself is network-bound; these tests only care about what
// the routes do with the failed list around it.
const importMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/recipe-import", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/recipe-import")>()),
  importRecipeFromUrl: importMock.fn,
}));
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-import-failures-"));
process.env.DATABASE_URL = join(tempDir, "test.db");
{
  const sqlite = new Database(process.env.DATABASE_URL);
  migrate(drizzle(sqlite), { migrationsFolder: "./drizzle" });
  sqlite.close();
}

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

let svc: typeof import("@/lib/recipes/import-failures");
let listRoute: typeof import("@/app/api/v1/recipes/import-failures/route");
let itemRoute: typeof import("@/app/api/v1/recipes/import-failures/[id]/route");
let importUrlRoute: typeof import("@/app/api/v1/recipes/import-url/route");
let recipesRoute: typeof import("@/app/api/v1/recipes/route");

beforeAll(async () => {
  svc = await import("@/lib/recipes/import-failures");
  listRoute = await import("@/app/api/v1/recipes/import-failures/route");
  itemRoute = await import("@/app/api/v1/recipes/import-failures/[id]/route");
  importUrlRoute = await import("@/app/api/v1/recipes/import-url/route");
  recipesRoute = await import("@/app/api/v1/recipes/route");
});

const post = (body: unknown) =>
  new Request("http://t", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const minimalRecipe = (extra: Record<string, unknown>) => ({
  title: "Kürbiskuchen",
  description: null,
  servings: 4,
  prepTimeMin: null,
  cookTimeMin: null,
  sourceUrl: null,
  photoPath: null,
  tags: [],
  sections: [{ title: null, instructions: "Backen.", ingredients: [] }],
  ...extra,
});

beforeEach(() => {
  svc.removeAllImportFailures();
});

const ctx = (id: number | string) => ({
  params: Promise.resolve({ id: String(id) }),
});

describe("import failures", () => {
  it("upserts per URL, bumping attempts and refreshing the error", () => {
    const a = svc.recordImportFailure("https://x.test/r", "noRecipe", "first");
    const b = svc.recordImportFailure(" https://x.test/r ", "fetch", "second");
    expect(b.id).toBe(a.id);
    const [row] = svc.listImportFailures();
    expect(row).toMatchObject({
      url: "https://x.test/r",
      errorCode: "fetch",
      errorMessage: "second",
      attempts: 2,
    });
  });

  it("clearImportFailureForUrl drops only that URL", () => {
    svc.recordImportFailure("https://x.test/a", "noRecipe", "m");
    svc.recordImportFailure("https://x.test/b", "noRecipe", "m");
    svc.clearImportFailureForUrl("https://x.test/a");
    expect(svc.listImportFailures().map((f) => f.url)).toEqual([
      "https://x.test/b",
    ]);
  });

  it("lists and deletes via the API routes", async () => {
    const { id } = svc.recordImportFailure("https://x.test/a", "parse", "m");
    svc.recordImportFailure("https://x.test/b", "parse", "m");

    const list = await listRoute.GET().json();
    expect(list.failures).toHaveLength(2);

    const one = await itemRoute.GET(new Request("http://t"), ctx(id));
    expect((await one.json()).url).toBe("https://x.test/a");

    const del = await itemRoute.DELETE(new Request("http://t"), ctx(id));
    expect(del.status).toBe(200);
    const again = await itemRoute.DELETE(new Request("http://t"), ctx(id));
    expect(again.status).toBe(404);
    expect(svc.listImportFailures()).toHaveLength(1);

    const all = await listRoute.DELETE().json();
    expect(all.removed).toBe(1);
    expect(svc.listImportFailures()).toEqual([]);
  });

  it("keeps the entry when a retry imports fine but nothing is saved", async () => {
    svc.recordImportFailure("https://x.test/r", "noRecipe", "m");
    importMock.fn.mockResolvedValueOnce({ title: "ok", sections: [] });
    const res = await importUrlRoute.POST(post({ url: "https://x.test/r" }));
    expect(res.status).toBe(200);
    expect(svc.listImportFailures().map((f) => f.url)).toEqual([
      "https://x.test/r",
    ]);
  });

  it("records a failed retry as another attempt", async () => {
    svc.recordImportFailure("https://x.test/r", "noRecipe", "m");
    const { ImportError } = await import("@/lib/recipe-import");
    importMock.fn.mockRejectedValueOnce(new ImportError("kaputt", "parse"));
    const res = await importUrlRoute.POST(post({ url: "https://x.test/r" }));
    expect(res.status).toBe(422);
    expect(svc.listImportFailures()[0]).toMatchObject({
      attempts: 2,
      errorCode: "parse",
    });
  });

  it("drops the entry once the imported recipe is saved", async () => {
    svc.recordImportFailure("https://x.test/start", "noRecipe", "m");
    svc.recordImportFailure("https://x.test/other", "noRecipe", "m");
    // The page redirected: sourceUrl is the final URL, importedFromUrl the
    // one on the failed list.
    const res = await recipesRoute.POST(
      post(
        minimalRecipe({
          sourceUrl: "https://x.test/final",
          importedFromUrl: "https://x.test/start",
        }),
      ),
    );
    expect(res.status).toBe(201);
    expect(svc.listImportFailures().map((f) => f.url)).toEqual([
      "https://x.test/other",
    ]);
  });

  it("drops the entry when a saved recipe's source URL matches it", async () => {
    svc.recordImportFailure("https://x.test/manual", "noRecipe", "m");
    const res = await recipesRoute.POST(
      post(minimalRecipe({ sourceUrl: "https://x.test/manual" })),
    );
    expect(res.status).toBe(201);
    expect(svc.listImportFailures()).toEqual([]);
  });
});
