import { eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { appSetting } from "../../db/schema.ts";

export type PlannerSettings = {
  /** Number of consecutive days visible on the planner. 1..28. */
  daysVisible: number;
  /** ISO weekday (1 = Monday … 7 = Sunday) that "Heute" snaps the window to. */
  startWeekday: number;
};

export const PLANNER_DEFAULTS: PlannerSettings = {
  daysVisible: 7,
  startWeekday: 1,
};

const KEY_DAYS_VISIBLE = "planner.days_visible";
const KEY_START_WEEKDAY = "planner.start_weekday";

export const PLANNER_SETTING_KEYS = [KEY_DAYS_VISIBLE, KEY_START_WEEKDAY] as const;

function clampInt(raw: string | undefined, min: number, max: number, fallback: number): number {
  if (raw == null) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

export function getPlannerSettings(): PlannerSettings {
  const rows = db
    .select()
    .from(appSetting)
    .where(inArray(appSetting.key, [KEY_DAYS_VISIBLE, KEY_START_WEEKDAY]))
    .all();
  const byKey = new Map(rows.map((r) => [r.key, r.value] as const));
  return {
    daysVisible: clampInt(byKey.get(KEY_DAYS_VISIBLE), 1, 28, PLANNER_DEFAULTS.daysVisible),
    startWeekday: clampInt(byKey.get(KEY_START_WEEKDAY), 1, 7, PLANNER_DEFAULTS.startWeekday),
  };
}

export function setPlannerSettings(values: Partial<PlannerSettings>): PlannerSettings {
  const current = getPlannerSettings();
  const next: PlannerSettings = {
    daysVisible: values.daysVisible ?? current.daysVisible,
    startWeekday: values.startWeekday ?? current.startWeekday,
  };
  if (next.daysVisible < 1 || next.daysVisible > 28) {
    throw new Error(`planner.days_visible out of range: ${next.daysVisible}`);
  }
  if (next.startWeekday < 1 || next.startWeekday > 7) {
    throw new Error(`planner.start_weekday out of range: ${next.startWeekday}`);
  }
  db.transaction((tx) => {
    upsert(tx, KEY_DAYS_VISIBLE, String(next.daysVisible));
    upsert(tx, KEY_START_WEEKDAY, String(next.startWeekday));
  });
  return next;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function upsert(tx: Tx, key: string, value: string): void {
  const existing = tx.select().from(appSetting).where(eq(appSetting.key, key)).get();
  if (existing) {
    tx.update(appSetting).set({ value }).where(eq(appSetting.key, key)).run();
  } else {
    tx.insert(appSetting).values({ key, value }).run();
  }
}
