import nextEnv from "@next/env";
import { parseArgs } from "node:util";

// Familywall snapshot downloader:
//   npm run familywall:download -- --email <e> --password <p> [flags]
//
// Wipes ./data/familywall-cache, drives a headless Chromium through
// Familywall, and saves a per-recipe snapshot for offline parsing.
// Re-running purges the prior cache.

const HELP = `Usage: npm run familywall:download -- --email <e> --password <p> [flags]

Required:
  --email <e>          Familywall account email
  --password <p>       Familywall account password

Optional:
  --limit <n>          Capture at most <n> recipes
  --recipe-id <id>     Capture only one recipe matched by data-fw-meta-id
                       (accepts "recipe/8084800_2230040" or just the suffix)
  --title <substring>  Capture only recipes whose title contains this
                       substring (case-insensitive). Ignored if
                       --recipe-id is set.
  --headed             Show the browser window (default: headless)
  --debug              Emit selector diagnostics
  --help               Print this help

Output goes under ./data/familywall-cache/:
  index.json                          List of captured recipes + timestamp
  recipes/<id-slug>/detail.html       Standalone viewable HTML
  recipes/<id-slug>/image.<ext>       Recipe photo bytes
  recipes/<id-slug>/meta.json         id, title, source URL, downloadedAt

Rerunning purges this directory before the new crawl starts.

First-time setup: \`npx playwright install chromium\`.`;

async function main() {
  nextEnv.loadEnvConfig(process.cwd(), true);

  let parsed;
  try {
    parsed = parseArgs({
      options: {
        email: { type: "string" },
        password: { type: "string" },
        limit: { type: "string" },
        "recipe-id": { type: "string" },
        title: { type: "string" },
        headed: { type: "boolean", default: false },
        debug: { type: "boolean", default: false },
        help: { type: "boolean", default: false },
      },
      allowPositionals: false,
      strict: true,
    });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    const message = (e as Error).message ?? String(e);
    if (code === "ERR_PARSE_ARGS_UNKNOWN_OPTION") {
      console.error(`[familywall] ${message}`);
      console.error("[familywall] Run with --help for the supported flags.");
      process.exit(2);
    }
    if (code === "ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL") {
      console.error("[familywall] couldn't parse arguments.");
      console.error(
        "[familywall] When using npm, separate the script flags with `--`:",
      );
      console.error(
        "  npm run familywall:download -- --email me@example.tld --password '…'",
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

  const { runFamilywallDownload } = await import(
    "../src/lib/familywall/download.ts"
  );

  console.log(
    `[familywall] launching browser (${parsed.values.headed ? "headed" : "headless"})`,
  );
  console.log(`[familywall] logging in as ${email}`);
  console.log(`[familywall] (cache will be purged before fetching)`);

  let printed = 0;
  const summary = await runFamilywallDownload({
    email,
    password,
    limit,
    headed: parsed.values.headed,
    debug: parsed.values.debug,
    onlyRecipeId: parsed.values["recipe-id"],
    onlyTitleSubstring: parsed.values.title,
    onRecipe: ({ title, outcome, error }) => {
      printed += 1;
      const label = `[${printed}]`.padEnd(6);
      const titleStr = `"${title}"`;
      let suffix = "";
      switch (outcome) {
        case "saved":
          suffix = " → saved";
          break;
        case "failed":
          suffix = ` → failed (${error ?? "unknown error"})`;
          break;
        case "skipped":
          suffix = " → skipped";
          break;
      }
      console.log(`${label} ${titleStr}${suffix}`);
    },
  });

  console.log("---");
  console.log(
    `done: ${summary.saved} saved, ${summary.skipped} skipped, ${summary.failed} failed`,
  );
}

main().catch((err) => {
  console.error("[familywall] fatal:", err);
  process.exit(1);
});
