import { eq } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { appSetting } from "../../db/schema.ts";

/**
 * The single unit applied to a quantity-bearing recipe line that carries no
 * explicit unit (e.g. "2 Tomaten" → 2 <global default>). Stored as a pointer
 * to a `unit.id` in `app_setting` so "exactly one" is free — switching is just
 * an overwrite, never a multi-row conflict. Seeded to "Stück" by migration.
 *
 * Used as the terminal step of the parser's unit-resolution chain
 * (alias default → ingredient default → global default) and as the matcher's
 * unit-decider fallback for the line side.
 */
export const GLOBAL_DEFAULT_UNIT_KEY = "global_default_unit_id";

/** The resolved global-default unit id, or null when unset / non-numeric. */
export function getGlobalDefaultUnitId(): number | null {
  const row = db
    .select({ value: appSetting.value })
    .from(appSetting)
    .where(eq(appSetting.key, GLOBAL_DEFAULT_UNIT_KEY))
    .get();
  if (!row) return null;
  const n = Number.parseInt(row.value, 10);
  return Number.isFinite(n) ? n : null;
}

/** Point the global default at `unitId`, overwriting any previous pointer. */
export function setGlobalDefaultUnitId(unitId: number): void {
  const value = String(unitId);
  db.transaction((tx) => {
    const existing = tx
      .select({ key: appSetting.key })
      .from(appSetting)
      .where(eq(appSetting.key, GLOBAL_DEFAULT_UNIT_KEY))
      .get();
    if (existing) {
      tx
        .update(appSetting)
        .set({ value })
        .where(eq(appSetting.key, GLOBAL_DEFAULT_UNIT_KEY))
        .run();
    } else {
      tx.insert(appSetting).values({ key: GLOBAL_DEFAULT_UNIT_KEY, value }).run();
    }
  });
}
