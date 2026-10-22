/**
 * Builds the local-dev seed snapshot from a prod database dump.
 *
 *   npm run seed:dev:create [-- <path/to/prod.db>]
 *
 * Source defaults to ./data/prod/nomly.db (falling back to the main checkout's
 * data/prod when run in a worktree). A `-wal` file next to the dump is merged
 * in — SQLite's backup API reads the database the way a live connection sees
 * it, so the snapshot never misses changes that were not checkpointed yet.
 *
 * Output: <main checkout>/data/dev-seed/nomly-dev.db (+ nomly-dev.json with the
 * snapshot date the loader shifts dates from). It is prod data, so it lives in
 * the gitignored data/ dir of the main checkout — never in the repo — where
 * every worktree finds it. The snapshot keeps the prod schema level; the
 * loader migrates it to head.
 *
 * Stripped, because they are secrets or only make sense on the real server:
 *   - api_token          (token hashes)
 *   - ical_feed          (private subscription URLs + cached calendar data)
 *   - recipe.photo_path  (the photo files are not part of the DB; locally they
 *                         would only render as broken images)
 * Kept: recipes, meal plans, articles, supermarkets, staples, shopping list,
 * purchase history, settings, and users + favorites (a dev login against the
 * same IdP maps to the same user, so favorites keep working).
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";

function mainCheckout(): string {
  const commonDir = execFileSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { encoding: "utf8" },
  ).trim();
  return dirname(commonDir);
}

function resolveSource(): string {
  const arg = process.argv[2];
  if (arg) return resolve(arg);
  const local = resolve("data/prod/nomly.db");
  if (existsSync(local)) return local;
  return join(mainCheckout(), "data/prod/nomly.db");
}

/** Local calendar day, YYYY-MM-DD. */
function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const OUT_DIR = join(mainCheckout(), "data/dev-seed");
const OUT_DB = join(OUT_DIR, "nomly-dev.db");
const OUT_META = join(OUT_DIR, "nomly-dev.json");

const source = resolveSource();
if (!existsSync(source)) {
  console.error(`No prod dump at ${source}.`);
  console.error(
    "Pull one with: scp 'docker-1:/DATA/AppData/nomly/data/nomly.db*' ./data/prod/",
  );
  process.exit(1);
}

const scratch = mkdtempSync(join(tmpdir(), "nomly-dev-seed-"));
const work = join(scratch, "seed.db");

console.log(`→ snapshotting ${source}`);
// Opening a WAL database checkpoints the WAL into the main file on close —
// that would rewrite the dump, which must stay pristine. So open a copy of the
// dump (with its -wal, if any) and back that up instead.
const copy = join(scratch, "source.db");
copyFileSync(source, copy);
if (existsSync(`${source}-wal`)) copyFileSync(`${source}-wal`, `${copy}-wal`);
const src = new Database(copy, { fileMustExist: true });
await src.backup(work);
src.close();

const db = new Database(work);
const count = (table: string): number =>
  (db.prepare(`SELECT count(*) AS c FROM "${table}"`).get() as { c: number }).c;

const integrity = db.pragma("integrity_check", { simple: true });
if (integrity !== "ok") {
  console.error(`Source failed integrity_check: ${String(integrity)}`);
  process.exit(1);
}

console.log("→ stripping secrets and server-only data");
db.transaction(() => {
  db.prepare("DELETE FROM api_token").run();
  db.prepare("DELETE FROM ical_feed").run();
  db.prepare("UPDATE recipe SET photo_path = NULL").run();
})();

const counts = Object.fromEntries(
  [
    "recipe",
    "meal_plan",
    "ingredient",
    "supermarket",
    "staple_group",
    "shopping_item",
    "ingredient_purchase",
    "user",
    "recipe_favorite",
  ].map((t) => [t, count(t)]),
);

mkdirSync(dirname(OUT_DB), { recursive: true });
rmSync(OUT_DB, { force: true });
// VACUUM INTO writes a compact, single-file (rollback-journal) copy.
db.prepare("VACUUM INTO ?").run(OUT_DB);
db.close();
rmSync(scratch, { recursive: true, force: true });

const meta = {
  // Dates in the snapshot are relative to this day; the loader shifts them by
  // whole weeks so the meal plan and purchase cadence line up with "today".
  snapshotDate: isoDay(new Date()),
  counts,
};
writeFileSync(OUT_META, `${JSON.stringify(meta, null, 2)}\n`);

const kb = Math.round(statSync(OUT_DB).size / 1024);
console.log(`→ wrote ${OUT_DB} (${kb} KB) and ${OUT_META}`);
console.log(JSON.stringify(counts, null, 2));
