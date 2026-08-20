import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import Database from "better-sqlite3";
import { sealData } from "iron-session";

import { E2E_CONFIG } from "./config.ts";

/**
 * Builds the world the e2e run needs: a disposable database with enough data to
 * look at, and a signed-in browser state.
 *
 * The auth problem that kept this harness unbuilt is solved without touching
 * production code: the session cookie is a plain iron-session seal, so we mint a
 * real one with the same secret the app boots with instead of adding a test-only
 * bypass to the app. No IdP is contacted — `renewSessionIfStale` only spends a
 * refresh token, and the minted session deliberately carries none.
 */
const NODE_FLAGS = [
  "--experimental-transform-types",
  "--disable-warning=ExperimentalWarning",
];

function run(script: string, env: Record<string, string>): void {
  execFileSync("node", [...NODE_FLAGS, script], {
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
}

async function mintStorageState(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const sealed = await sealData(
    {
      sub: "e2e-user",
      name: "E2E",
      email: "e2e@nomly.test",
      exp: now + 3600,
      issuedAt: now,
      // No refreshToken on purpose: nothing may try to reach the dummy IdP.
    },
    { password: E2E_CONFIG.sessionSecret, ttl: 60 * 60 * 24 * 90 },
  );

  mkdirSync(dirname(E2E_CONFIG.storageStatePath), { recursive: true });
  writeFileSync(
    E2E_CONFIG.storageStatePath,
    JSON.stringify(
      {
        cookies: [
          {
            name: "__nomly_session",
            value: sealed,
            domain: "127.0.0.1",
            path: "/",
            httpOnly: true,
            secure: false,
            sameSite: "Lax",
            expires: now + 60 * 60 * 24 * 90,
          },
        ],
        origins: [],
      },
      null,
      2,
    ),
  );
}

/** A handful of shopping rows, so the offline list has something to render. */
function seedShoppingList(dbPath: string): void {
  const db = new Database(dbPath);
  try {
    const ingredients = db
      .prepare("SELECT id FROM ingredient ORDER BY id LIMIT 4")
      .all() as { id: number }[];
    if (ingredients.length === 0) {
      throw new Error("e2e seed produced no ingredients to shop for");
    }
    const insert = db.prepare(
      "INSERT INTO shopping_item (ingredient_id, quantity, checked, sort_order) VALUES (?, ?, 0, ?)",
    );
    ingredients.forEach((row, i) => insert.run(row.id, i + 1, i));
  } finally {
    db.close();
  }
}

export default async function globalSetup(): Promise<void> {
  const dbPath = resolve(E2E_CONFIG.databaseUrl);
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${dbPath}${suffix}`, { force: true });
  }
  mkdirSync(dirname(dbPath), { recursive: true });

  const env = { DATABASE_URL: E2E_CONFIG.databaseUrl };
  run("scripts/migrate.mts", env);
  run("scripts/seed.ts", env);
  seedShoppingList(dbPath);
  await mintStorageState();
}
