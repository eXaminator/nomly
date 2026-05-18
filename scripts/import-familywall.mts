import nextEnv from "@next/env";
import { parseArgs } from "node:util";

// Familywall import CLI:
//   npm run import:familywall -- --email <e> --password <p> [flags]
//
// Flags:
//   --email <e>        Familywall account email (required)
//   --password <p>     Familywall account password (required)
//   --limit <n>        Cap recipes processed (handy for first runs)
//   --dry-run          Crawl + transform but never write to the DB
//   --headed           Show the Chromium window
//   --help             Print this help
//
// First-time setup: `npx playwright install chromium`.

const HELP = `Usage: npm run import:familywall -- --email <e> --password <p> [flags]

Required:
  --email <e>          Familywall account email
  --password <p>       Familywall account password

Optional:
  --limit <n>          Process at most <n> recipes
  --dry-run            Parse + transform, but skip every DB write
  --headed             Show the browser window (default: headless)
  --debug              Emit selector diagnostics (URLs, anchor counts, etc.)
  --help               Print this help

The CLI writes to the same SQLite DB the running server uses
(\$DATABASE_URL, defaults to ./data/nomly.db). Re-runs are safe — recipes
already imported (matched by title + original source URL) are skipped.`;

async function main() {
  // Load .env / .env.local before anything reads process.env.
  nextEnv.loadEnvConfig(process.cwd(), true);

  let parsed;
  try {
    parsed = parseArgs({
      options: {
        email: { type: "string" },
        password: { type: "string" },
        limit: { type: "string" },
        "dry-run": { type: "boolean", default: false },
        headed: { type: "boolean", default: false },
        debug: { type: "boolean", default: false },
        help: { type: "boolean", default: false },
      },
      allowPositionals: false,
      strict: true,
    });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (
      code === "ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL" ||
      code === "ERR_PARSE_ARGS_UNKNOWN_OPTION"
    ) {
      console.error("[familywall] couldn't parse arguments.");
      console.error(
        "[familywall] When using npm, separate the script flags with `--`:",
      );
      console.error(
        "  npm run import:familywall -- --email me@example.tld --password '…'",
      );
      console.error(
        "[familywall] Without the `--`, npm consumes the flags before they reach the script.",
      );
      process.exit(2);
    }
    throw e;
  }

  if (parsed.values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const email = parsed.values.email ?? "";
  const password = parsed.values.password ?? "";
  if (!email || !password) {
    console.error("[familywall] missing credentials. Pass --email and --password.");
    process.exit(2);
  }
  const limit = parsed.values.limit ? parseInt(parsed.values.limit, 10) : undefined;
  if (parsed.values.limit && (Number.isNaN(limit) || (limit ?? 0) <= 0)) {
    console.error("[familywall] --limit must be a positive integer.");
    process.exit(2);
  }

  // Lazy-import so the heavy modules (Playwright, drizzle, etc.) don't load
  // when the user just runs `--help`.
  const { runFamilywallImport } = await import("../src/lib/familywall/index.ts");

  console.log(
    `[familywall] launching browser (${parsed.values.headed ? "headed" : "headless"})`,
  );
  console.log(`[familywall] logging in as ${email}`);

  let printed = 0;
  const summary = await runFamilywallImport({
    email,
    password,
    limit,
    headed: parsed.values.headed,
    debug: parsed.values.debug,
    dryRun: parsed.values["dry-run"],
    onRecipe: ({ title, outcome, recipeId, error }) => {
      printed += 1;
      const label = `[${printed}]`;
      const titleStr = `"${title}"`;
      let suffix = "";
      switch (outcome) {
        case "imported":
          suffix = ` → imported${recipeId ? ` (id ${recipeId})` : ""}`;
          break;
        case "would-import":
          suffix = " → would import";
          break;
        case "skipped":
          suffix = " → skipped (already imported)";
          break;
        case "failed":
          suffix = ` → failed (${error ?? "unknown error"})`;
          break;
      }
      console.log(`${label.padEnd(6)} ${titleStr}${suffix}`);
    },
  });

  console.log("---");
  console.log(
    `done: ${summary.imported} imported, ${summary.skipped} skipped, ${summary.failed} failed`,
  );
  if (parsed.values["dry-run"]) {
    console.log("(dry run — nothing written to the DB)");
  }
}

main().catch((err) => {
  console.error("[familywall] fatal:", err);
  process.exit(1);
});
