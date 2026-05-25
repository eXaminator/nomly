import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The cache module pins its root to `process.cwd()/data/familywall-cache`
// at import time. Point the cwd at a fresh tempdir before importing so the
// real cache (and any user-checked-in fixtures) stay untouched.
const tempDir = mkdtempSync(join(tmpdir(), "nomly-familywall-cache-"));
const originalCwd = process.cwd();
process.chdir(tempDir);

const cache = await import("@/lib/familywall/cache");

afterAll(() => {
  process.chdir(originalCwd);
  rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
  cache.clearCache();
});

describe("mergeIndex", () => {
  it("acts as writeIndex when no prior index exists", () => {
    cache.mergeIndex([
      { id: "recipe/1", title: "Apfelkuchen" },
      { id: "recipe/2", title: "Tomatensuppe" },
    ]);
    const out = cache.readIndex()!;
    expect(out.count).toBe(2);
    expect(out.recipes.map((r) => r.id)).toEqual(["recipe/1", "recipe/2"]);
  });

  it("preserves existing recipes when re-downloading a different one", () => {
    cache.writeIndex([
      { id: "recipe/1", title: "Apfelkuchen" },
      { id: "recipe/2", title: "Tomatensuppe" },
      { id: "recipe/3", title: "Pizza" },
    ]);
    cache.mergeIndex([{ id: "recipe/2", title: "Tomatensuppe" }]);
    const out = cache.readIndex()!;
    expect(out.count).toBe(3);
    // All three survive — only the targeted one was "refreshed".
    expect(new Set(out.recipes.map((r) => r.id))).toEqual(
      new Set(["recipe/1", "recipe/2", "recipe/3"]),
    );
  });

  it("replaces the existing entry's title when the recipe was renamed", () => {
    cache.writeIndex([
      { id: "recipe/1", title: "Apfelkuchen" },
      { id: "recipe/2", title: "Tomatensuppe alt" },
    ]);
    cache.mergeIndex([{ id: "recipe/2", title: "Tomatensuppe neu" }]);
    const out = cache.readIndex()!;
    const updated = out.recipes.find((r) => r.id === "recipe/2");
    expect(updated?.title).toBe("Tomatensuppe neu");
  });

  it("adds a recipe that wasn't in the prior index", () => {
    cache.writeIndex([{ id: "recipe/1", title: "Apfelkuchen" }]);
    cache.mergeIndex([{ id: "recipe/99", title: "Neu hinzugefügt" }]);
    const out = cache.readIndex()!;
    expect(out.count).toBe(2);
    expect(out.recipes.find((r) => r.id === "recipe/99")?.title).toBe(
      "Neu hinzugefügt",
    );
  });

  it("updates downloadedAt so the import CLI's hint stays honest", async () => {
    cache.writeIndex([{ id: "recipe/1", title: "Apfelkuchen" }]);
    const before = cache.readIndex()!.downloadedAt;
    // Sleep ≥1ms so the ISO timestamp differs.
    await new Promise((r) => setTimeout(r, 5));
    cache.mergeIndex([{ id: "recipe/1", title: "Apfelkuchen" }]);
    const after = cache.readIndex()!.downloadedAt;
    expect(after).not.toBe(before);
    expect(new Date(after).getTime()).toBeGreaterThan(
      new Date(before).getTime(),
    );
  });
});
