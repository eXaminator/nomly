import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const tempDir = mkdtempSync(join(tmpdir(), "nomly-mealplan-"));
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

async function seedRecipe(): Promise<number> {
  const { db } = await import("@/db");
  const { recipe } = await import("@/db/schema");
  const inserted = db
    .insert(recipe)
    .values({ title: "Spaghetti", servings: 2 })
    .returning({ id: recipe.id })
    .all();
  return inserted[0].id;
}

async function resetMeals(): Promise<void> {
  const { db } = await import("@/db");
  const { mealPlan } = await import("@/db/schema");
  db.delete(mealPlan).run();
}

async function listOnDate(date: string) {
  const { db } = await import("@/db");
  const { mealPlan } = await import("@/db/schema");
  const { asc, eq } = await import("drizzle-orm");
  return db
    .select()
    .from(mealPlan)
    .where(eq(mealPlan.date, date))
    .orderBy(asc(mealPlan.sortOrder))
    .all();
}

describe("meal-plan service", () => {
  let recipeId: number;

  beforeAll(async () => {
    recipeId = await seedRecipe();
  });

  beforeEach(async () => {
    await resetMeals();
  });

  it("createMeal appends with monotonic sort_order", async () => {
    const { createMeal } = await import("@/lib/meal-plans/service");
    const a = createMeal({ recipeId, date: "2026-05-22" });
    const b = createMeal({ recipeId, date: "2026-05-22" });
    const c = createMeal({ recipeId, date: "2026-05-22" });
    const rows = await listOnDate("2026-05-22");
    expect(rows.map((r) => r.id)).toEqual([a, b, c]);
    expect(rows.map((r) => r.sortOrder)).toEqual([0, 1, 2]);
  });

  it("createMeal defaults servings_override to the recipe's base servings", async () => {
    const { createMeal } = await import("@/lib/meal-plans/service");
    const id = createMeal({ recipeId, date: "2026-05-22" });
    const rows = await listOnDate("2026-05-22");
    expect(rows.find((r) => r.id === id)?.servingsOverride).toBe(2);
  });

  it("createMeal bumps a recipe's schema-default `servings = 1` up to 2", async () => {
    // Most imported recipes never explicitly set `servings` and inherit the
    // schema default of 1 — which feels too small for a planned meal. The
    // service falls back to `defaultMealPortions` for the bump.
    const { db } = await import("@/db");
    const { recipe } = await import("@/db/schema");
    const onePortionRecipe = db
      .insert(recipe)
      .values({ title: "Eintopf für eine Person", servings: 1 })
      .returning({ id: recipe.id })
      .all()[0].id;

    const { createMeal } = await import("@/lib/meal-plans/service");
    const id = createMeal({ recipeId: onePortionRecipe, date: "2026-05-22" });
    const rows = await listOnDate("2026-05-22");
    expect(rows.find((r) => r.id === id)?.servingsOverride).toBe(2);
  });

  it("createMeal preserves an explicit override even when it would be below the default", async () => {
    const { createMeal } = await import("@/lib/meal-plans/service");
    const id = createMeal({
      recipeId,
      date: "2026-05-22",
      servingsOverride: 1,
    });
    const rows = await listOnDate("2026-05-22");
    expect(rows.find((r) => r.id === id)?.servingsOverride).toBe(1);
  });

  it("reorderUp within a day swaps neighbours", async () => {
    const { createMeal, reorderUp } = await import("@/lib/meal-plans/service");
    const a = createMeal({ recipeId, date: "2026-05-22" });
    const b = createMeal({ recipeId, date: "2026-05-22" });
    reorderUp(b);
    const rows = await listOnDate("2026-05-22");
    expect(rows.map((r) => r.id)).toEqual([b, a]);
  });

  it("reorderDown within a day swaps neighbours", async () => {
    const { createMeal, reorderDown } = await import("@/lib/meal-plans/service");
    const a = createMeal({ recipeId, date: "2026-05-22" });
    const b = createMeal({ recipeId, date: "2026-05-22" });
    reorderDown(a);
    const rows = await listOnDate("2026-05-22");
    expect(rows.map((r) => r.id)).toEqual([b, a]);
  });

  it("reorderUp at top-of-day moves the meal to the bottom of the previous day", async () => {
    const { createMeal, reorderUp } = await import("@/lib/meal-plans/service");
    const prev1 = createMeal({ recipeId, date: "2026-05-21" });
    const prev2 = createMeal({ recipeId, date: "2026-05-21" });
    const top = createMeal({ recipeId, date: "2026-05-22" });

    reorderUp(top);

    const prevDay = await listOnDate("2026-05-21");
    const today = await listOnDate("2026-05-22");
    expect(prevDay.map((r) => r.id)).toEqual([prev1, prev2, top]);
    expect(today).toEqual([]);
  });

  it("reorderDown at bottom-of-day moves the meal to the top of the next day", async () => {
    const { createMeal, reorderDown } = await import("@/lib/meal-plans/service");
    const bottom = createMeal({ recipeId, date: "2026-05-22" });
    const next1 = createMeal({ recipeId, date: "2026-05-23" });
    const next2 = createMeal({ recipeId, date: "2026-05-23" });

    reorderDown(bottom);

    const today = await listOnDate("2026-05-22");
    const nextDay = await listOnDate("2026-05-23");
    expect(today).toEqual([]);
    // `bottom` slots above the existing meals via min-1 sort_order.
    expect(nextDay.map((r) => r.id)).toEqual([bottom, next1, next2]);
  });

  it("cross-day reorder works into an empty previous/next day (off-page is fine)", async () => {
    const { createMeal, reorderUp, reorderDown } = await import("@/lib/meal-plans/service");
    const id = createMeal({ recipeId, date: "2026-05-22" });

    reorderUp(id);
    expect((await listOnDate("2026-05-22")).length).toBe(0);
    expect((await listOnDate("2026-05-21")).map((r) => r.id)).toEqual([id]);

    reorderDown(id);
    expect((await listOnDate("2026-05-21")).length).toBe(0);
    expect((await listOnDate("2026-05-22")).map((r) => r.id)).toEqual([id]);
  });

  it("reorderUp at the topmost meal of the topmost day still walks into the past", async () => {
    // This is the "not bounded by the visible page" guarantee: the planner
    // page can be showing 2026-05-22..28, the user clicks ↑ on a meal at the
    // top of 22, and the meal lands on 21 (off-page). The user can then page
    // back to find it.
    const { createMeal, reorderUp } = await import("@/lib/meal-plans/service");
    const id = createMeal({ recipeId, date: "2026-05-22" });
    reorderUp(id);
    expect((await listOnDate("2026-05-21")).map((r) => r.id)).toEqual([id]);
    reorderUp(id);
    expect((await listOnDate("2026-05-20")).map((r) => r.id)).toEqual([id]);
  });

  it("month boundaries: reorderUp from the 1st walks into the previous month", async () => {
    const { createMeal, reorderUp } = await import("@/lib/meal-plans/service");
    const id = createMeal({ recipeId, date: "2026-06-01" });
    reorderUp(id);
    expect((await listOnDate("2026-05-31")).map((r) => r.id)).toEqual([id]);
  });

  it("moveMealToDay appends at the end of the target date", async () => {
    const { createMeal, moveMealToDay } = await import("@/lib/meal-plans/service");
    const t1 = createMeal({ recipeId, date: "2026-05-22" });
    const t2 = createMeal({ recipeId, date: "2026-05-22" });
    const src = createMeal({ recipeId, date: "2026-05-23" });

    moveMealToDay(src, "2026-05-22");

    const rows = await listOnDate("2026-05-22");
    expect(rows.map((r) => r.id)).toEqual([t1, t2, src]);
  });

  it("reorderDay rewrites sort_order to match the supplied order", async () => {
    const { createMeal, reorderDay } = await import("@/lib/meal-plans/service");
    const a = createMeal({ recipeId, date: "2026-05-22" });
    const b = createMeal({ recipeId, date: "2026-05-22" });
    const c = createMeal({ recipeId, date: "2026-05-22" });

    reorderDay("2026-05-22", [c, a, b]);

    const rows = await listOnDate("2026-05-22");
    expect(rows.map((r) => r.id)).toEqual([c, a, b]);
    expect(rows.map((r) => r.sortOrder)).toEqual([0, 1, 2]);
  });

  it("deleteMeal removes the row but leaves sibling sort_orders alone", async () => {
    const { createMeal, deleteMeal } = await import("@/lib/meal-plans/service");
    const a = createMeal({ recipeId, date: "2026-05-22" });
    const b = createMeal({ recipeId, date: "2026-05-22" });
    const c = createMeal({ recipeId, date: "2026-05-22" });

    deleteMeal(b);

    const rows = await listOnDate("2026-05-22");
    expect(rows.map((r) => r.id)).toEqual([a, c]);
  });
});

describe("recipe usage stats", () => {
  let recipeId: number;
  let otherRecipeId: number;

  beforeAll(async () => {
    const { db } = await import("@/db");
    const { recipe } = await import("@/db/schema");
    recipeId = db
      .insert(recipe)
      .values({ title: "Curry", servings: 2 })
      .returning({ id: recipe.id })
      .all()[0].id;
    otherRecipeId = db
      .insert(recipe)
      .values({ title: "Salat", servings: 2 })
      .returning({ id: recipe.id })
      .all()[0].id;
  });

  beforeEach(async () => {
    const { db } = await import("@/db");
    const { mealPlan } = await import("@/db/schema");
    db.delete(mealPlan).run();
  });

  it("returns last (before today) + next (today or later) per recipe", async () => {
    const { createMeal, getRecipeUsageStats } = await import(
      "@/lib/meal-plans/service"
    );
    const today = "2026-05-22";
    createMeal({ recipeId, date: "2026-05-10" });
    createMeal({ recipeId, date: "2026-05-19" });
    createMeal({ recipeId, date: today });
    createMeal({ recipeId, date: "2026-05-25" });

    const stats = getRecipeUsageStats(today);
    const r = stats.get(recipeId);
    expect(r?.lastPlanned).toBe("2026-05-19");
    expect(r?.nextPlanned).toBe(today);
  });

  it("treats today as 'next', not 'last'", async () => {
    const { createMeal, getRecipeUsageStats } = await import(
      "@/lib/meal-plans/service"
    );
    const today = "2026-05-22";
    createMeal({ recipeId, date: today });
    const r = getRecipeUsageStats(today).get(recipeId);
    expect(r?.lastPlanned).toBeNull();
    expect(r?.nextPlanned).toBe(today);
  });

  it("counts plannings in [today-30, today-1] (excluding today and the future)", async () => {
    const { createMeal, getRecipeUsageStats } = await import(
      "@/lib/meal-plans/service"
    );
    const today = "2026-05-22";
    // within window: today-30 (2026-04-22), today-1 (2026-05-21), and one in between
    createMeal({ recipeId, date: "2026-04-22" });
    createMeal({ recipeId, date: "2026-05-10" });
    createMeal({ recipeId, date: "2026-05-21" });
    // outside window: too old (today-31), today, future
    createMeal({ recipeId, date: "2026-04-21" });
    createMeal({ recipeId, date: today });
    createMeal({ recipeId, date: "2026-05-25" });

    const r = getRecipeUsageStats(today).get(recipeId);
    expect(r?.count30d).toBe(3);
  });

  it("isolates stats per recipe", async () => {
    const { createMeal, getRecipeUsageStats } = await import(
      "@/lib/meal-plans/service"
    );
    const today = "2026-05-22";
    createMeal({ recipeId, date: "2026-05-19" });
    createMeal({ recipeId, date: "2026-05-20" });
    createMeal({ recipeId: otherRecipeId, date: "2026-05-15" });

    const stats = getRecipeUsageStats(today);
    expect(stats.get(recipeId)?.count30d).toBe(2);
    expect(stats.get(otherRecipeId)?.count30d).toBe(1);
  });
});

describe("planner settings", () => {
  beforeEach(async () => {
    const { db } = await import("@/db");
    const { appSetting } = await import("@/db/schema");
    db.delete(appSetting).run();
  });

  it("returns defaults when no rows exist", async () => {
    const { getPlannerSettings, PLANNER_DEFAULTS } = await import(
      "@/lib/settings/planner"
    );
    expect(getPlannerSettings()).toEqual(PLANNER_DEFAULTS);
  });

  it("clamps out-of-range stored values to the defaults", async () => {
    const { db } = await import("@/db");
    const { appSetting } = await import("@/db/schema");
    db.insert(appSetting).values({ key: "planner.days_visible", value: "0" }).run();
    db.insert(appSetting).values({ key: "planner.start_weekday", value: "99" }).run();
    const { getPlannerSettings } = await import("@/lib/settings/planner");
    const s = getPlannerSettings();
    expect(s.daysVisible).toBe(1);
    expect(s.startWeekday).toBe(7);
  });

  it("setPlannerSettings persists and round-trips", async () => {
    const { getPlannerSettings, setPlannerSettings } = await import(
      "@/lib/settings/planner"
    );
    setPlannerSettings({ daysVisible: 14, startWeekday: 7 });
    expect(getPlannerSettings()).toEqual({ daysVisible: 14, startWeekday: 7 });
    setPlannerSettings({ daysVisible: 3 });
    expect(getPlannerSettings()).toEqual({ daysVisible: 3, startWeekday: 7 });
  });
});

describe("planner date helpers", () => {
  it("alignToStartWeekday snaps back to the requested weekday", async () => {
    const { alignToStartWeekday } = await import("@/lib/meal-plans/dates");
    // 2026-05-22 is a Friday (ISO weekday 5).
    expect(alignToStartWeekday("2026-05-22", 1)).toBe("2026-05-18"); // Monday
    expect(alignToStartWeekday("2026-05-22", 5)).toBe("2026-05-22"); // Friday (same day)
    expect(alignToStartWeekday("2026-05-22", 7)).toBe("2026-05-17"); // previous Sunday
  });

  it("buildRange returns daysVisible consecutive ISO dates", async () => {
    const { buildRange } = await import("@/lib/meal-plans/dates");
    const r = buildRange("2026-05-18", 7);
    expect(r.dates).toEqual([
      "2026-05-18",
      "2026-05-19",
      "2026-05-20",
      "2026-05-21",
      "2026-05-22",
      "2026-05-23",
      "2026-05-24",
    ]);
    expect(r.to).toBe("2026-05-24");
  });
});
