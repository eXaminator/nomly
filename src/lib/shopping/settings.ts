import { eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.ts";
import { appSetting } from "../../db/schema.ts";

export type ShoppingSettings = {
  /** Default length for the "Mahlzeiten hinzufügen" date-range picker. */
  defaultLengthDays: number;
};

export const SHOPPING_DEFAULTS: ShoppingSettings = {
  defaultLengthDays: 7,
};

const KEY_DEFAULT_LENGTH = "shopping_list.default_length_days";

export const SHOPPING_SETTING_KEYS = [KEY_DEFAULT_LENGTH] as const;

function clampInt(
  raw: string | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (raw == null) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

export function getShoppingSettings(): ShoppingSettings {
  const rows = db
    .select()
    .from(appSetting)
    .where(inArray(appSetting.key, [KEY_DEFAULT_LENGTH]))
    .all();
  const byKey = new Map(rows.map((r) => [r.key, r.value] as const));
  return {
    defaultLengthDays: clampInt(
      byKey.get(KEY_DEFAULT_LENGTH),
      1,
      60,
      SHOPPING_DEFAULTS.defaultLengthDays,
    ),
  };
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

export function setShoppingSettings(values: Partial<ShoppingSettings>): ShoppingSettings {
  const current = getShoppingSettings();
  const next: ShoppingSettings = {
    defaultLengthDays: values.defaultLengthDays ?? current.defaultLengthDays,
  };
  if (next.defaultLengthDays < 1 || next.defaultLengthDays > 60) {
    throw new Error(`shopping_list.default_length_days out of range: ${next.defaultLengthDays}`);
  }
  db.transaction((tx) => {
    upsert(tx, KEY_DEFAULT_LENGTH, String(next.defaultLengthDays));
  });
  return next;
}
