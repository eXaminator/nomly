/**
 * Loads the local-dev seed snapshot (data/dev-seed/nomly-dev.db of the main
 * checkout, built by `npm run seed:dev:create`) into the dev database, then
 * migrates it to head.
 *
 *   npm run seed:dev:load              # only into a missing/empty database
 *   npm run seed:dev:load -- --force   # replace an existing one (stop the dev server first)
 *
 * Target: DATABASE_URL, default ./data/nomly.db. A seed in this checkout's own
 * data/dev-seed wins over the main checkout's.
 *
 * The snapshot is frozen at its creation day. Everything date-driven — the
 * planner week, "Mahlzeiten hinzufügen", due-soon suggestions from the purchase
 * cadence, the learned store order's one-year window — would drift into the
 * past, so all such dates move forward by whole weeks (weekdays stay put) to
 * line the snapshot day up with today.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";

if (process.env.NODE_ENV && process.env.NODE_ENV !== "development") {
  console.error(
    `Refusing to load the dev seed with NODE_ENV=${process.env.NODE_ENV}.`,
  );
  process.exit(1);
}

const force = process.argv.includes("--force");
const target = resolve(process.env.DATABASE_URL ?? "./data/nomly.db");

function mainCheckout(): string {
  const commonDir = execFileSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { encoding: "utf8" },
  ).trim();
  return dirname(commonDir);
}

function findSeed(): { db: string; meta: string } | null {
  for (const dir of [resolve("data/dev-seed"), join(mainCheckout(), "data/dev-seed")]) {
    const db = join(dir, "nomly-dev.db");
    const meta = join(dir, "nomly-dev.json");
    if (existsSync(db) && existsSync(meta)) return { db, meta };
  }
  return null;
}

/** True when the target holds no data worth keeping (missing, or no units). */
function isEmptyDatabase(path: string): boolean {
  if (!existsSync(path)) return true;
  const db = new Database(path, { readonly: true });
  try {
    const row = db.prepare("SELECT count(*) AS c FROM unit").get() as { c: number };
    return row.c === 0;
  } catch {
    return true; // not migrated yet
  } finally {
    db.close();
  }
}

const seed = findSeed();
if (!seed) {
  console.error("No dev seed found (data/dev-seed/nomly-dev.db + nomly-dev.json).");
  console.error("Create one from a prod dump with: npm run seed:dev:create");
  process.exit(1);
}
if (!force && !isEmptyDatabase(target)) {
  console.error(`${target} already has data; pass --force to replace it.`);
  process.exit(1);
}

const { snapshotDate } = JSON.parse(readFileSync(seed.meta, "utf8")) as {
  snapshotDate: string;
};
const DAY = 24 * 60 * 60;
const snapshot = new Date(`${snapshotDate}T00:00:00`);
const today = new Date();
today.setHours(0, 0, 0, 0);
const elapsedDays = Math.round((today.getTime() - snapshot.getTime()) / (DAY * 1000));
const shiftDays = Math.max(0, Math.floor(elapsedDays / 7) * 7);

console.log(`→ loading ${seed.db} into ${target}`);
mkdirSync(dirname(target), { recursive: true });
for (const suffix of ["", "-wal", "-shm"]) rmSync(`${target}${suffix}`, { force: true });
copyFileSync(seed.db, target);

if (shiftDays > 0) {
  console.log(`→ moving dates forward ${shiftDays} days (snapshot ${snapshotDate})`);
  const db = new Database(target);
  const seconds = shiftDays * DAY;
  db.transaction(() => {
    db.prepare("UPDATE meal_plan SET date = date(date, ?)").run(`+${shiftDays} days`);
    db.prepare("UPDATE ingredient_purchase SET purchased_at = purchased_at + ?").run(seconds);
    db.prepare(
      `UPDATE shopping_item SET
         checked_at = checked_at + ?,
         created_at = created_at + ?,
         updated_at = updated_at + ?`,
    ).run(seconds, seconds, seconds);
  })();
  db.close();
}

console.log("→ migrating to head");
execFileSync(
  process.execPath,
  [
    "--experimental-transform-types",
    "--disable-warning=ExperimentalWarning",
    "scripts/migrate.mts",
  ],
  { stdio: "inherit", env: { ...process.env, DATABASE_URL: target } },
);
console.log("→ dev seed loaded");
