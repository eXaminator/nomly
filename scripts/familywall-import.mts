import nextEnv from "@next/env";
import { parseArgs } from "node:util";
import { createInterface } from "node:readline/promises";

// Familywall import CLI:
//   npm run familywall:import -- [flags]
//
// Reads cached snapshots from ./data/familywall-cache/ (written by
// `npm run familywall:download`) and ingests them into the nomly DB.
// Never talks to Familywall directly — re-runs over the same cache are
// free, which lets the parser iterate without re-downloading.

const HELP = `Usage: npm run familywall:import -- [flags]

Optional:
  --limit <n>          Process at most <n> cached recipes
  --recipe-id <id>     Import only the cached recipe whose
                       data-fw-meta-id matches (accepts
                       "recipe/8084800_2230040" or just the suffix)
  --title <substring>  Import only cached recipes whose title contains
                       this substring (case-insensitive). Ignored if
                       --recipe-id is set.
  --dry-run            Parse + transform, but skip every DB write
  --overwrite          Re-import recipes that already exist (update in
                       place — dedup key: title + source URL)
  --yes                Skip the "use existing cache?" prompt
  --debug              Emit parsing diagnostics for each snapshot
  --api <baseUrl>      Import into a remote nomly over its HTTP API instead
                       of the local DB (e.g. https://nomly.example.tld).
                       Recipes are parsed locally and POSTed — photos and
                       all — so ingredient matching runs against the live
                       catalog. The local HTML cache is kept as your backup.
  --token <token>      Bearer token for --api (mint with
                       \`npm run token:create\`). If omitted, you'll be
                       prompted for it (input hidden).
  --help               Print this help

Run \`npm run familywall:download\` first if the cache doesn't exist
(or you want a fresh snapshot). Cache lives under
./data/familywall-cache/.`;

async function confirm(prompt: string, defaultYes = true): Promise<boolean> {
  if (!process.stdin.isTTY) return defaultYes;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const suffix = defaultYes ? "[Y/n]" : "[y/N]";
  const answer = (await rl.question(`${prompt} ${suffix} `)).trim().toLowerCase();
  rl.close();
  if (answer === "") return defaultYes;
  return answer === "y" || answer === "yes" || answer === "j" || answer === "ja";
}

/**
 * Read a bearer token interactively, masking keystrokes so the secret doesn't
 * linger in the terminal scrollback. Returns "" when stdin isn't a TTY so the
 * caller can fail with a helpful message instead of hanging.
 */
async function promptToken(): Promise<string> {
  if (!process.stdin.isTTY) return "";
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  // `_writeToOutput` is what readline uses to echo the prompt and each typed
  // character. We let the prompt through, then suppress everything else so the
  // token isn't echoed.
  const iface = rl as unknown as { _writeToOutput?: (s: string) => void };
  const realWrite = iface._writeToOutput?.bind(rl);
  let mask = false;
  if (realWrite) {
    iface._writeToOutput = (s: string) => {
      if (!mask) realWrite(s);
    };
  }
  try {
    const pending = rl.question("API-Token (Eingabe verborgen): ");
    mask = true;
    return (await pending).trim();
  } finally {
    rl.close();
    process.stdout.write("\n");
  }
}

function formatRelative(date: Date): string {
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86_400)}d ago`;
}

async function main() {
  nextEnv.loadEnvConfig(process.cwd(), true);

  let parsed;
  try {
    parsed = parseArgs({
      options: {
        limit: { type: "string" },
        "recipe-id": { type: "string" },
        title: { type: "string" },
        "dry-run": { type: "boolean", default: false },
        overwrite: { type: "boolean", default: false },
        yes: { type: "boolean", default: false },
        debug: { type: "boolean", default: false },
        api: { type: "string" },
        token: { type: "string" },
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
      console.error("  npm run familywall:import -- --overwrite");
      process.exit(2);
    }
    throw e;
  }

  if (parsed.values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const limit = parsed.values.limit ? parseInt(parsed.values.limit, 10) : undefined;
  if (parsed.values.limit && (Number.isNaN(limit) || (limit ?? 0) <= 0)) {
    console.error("[familywall] --limit must be a positive integer.");
    process.exit(2);
  }

  // Lazy-import the cache helpers so --help doesn't pull in jsdom etc.
  const { cacheStats } = await import("../src/lib/familywall/cache.ts");
  const stats = cacheStats();
  if (!stats.exists || stats.count === 0) {
    console.error("[familywall] no cached snapshots found at ./data/familywall-cache/.");
    console.error("[familywall] Run `npm run familywall:download -- --email <e> --password <p>` first.");
    process.exit(1);
  }

  if (!parsed.values.yes) {
    const downloaded = stats.downloadedAt
      ? `downloaded ${formatRelative(stats.downloadedAt)} on ${stats.downloadedAt.toISOString()}`
      : "no timestamp";
    const ok = await confirm(
      `[familywall] Use existing cache (${stats.count} recipes, ${downloaded})?`,
      true,
    );
    if (!ok) {
      console.error(
        "[familywall] aborted — run `npm run familywall:download` to refresh the cache, then re-run this command.",
      );
      process.exit(1);
    }
  }

  // Shared per-recipe progress printer (both the local-DB and API runners
  // emit the same outcome shape).
  let printed = 0;
  const onRecipe = ({
    title,
    outcome,
    recipeId,
    error,
  }: {
    title: string;
    outcome: string;
    recipeId?: number;
    error?: string;
  }) => {
    printed += 1;
    const label = `[${printed}]`;
    const titleStr = `"${title}"`;
    let suffix = "";
    switch (outcome) {
      case "imported":
        suffix = ` → imported${recipeId ? ` (id ${recipeId})` : ""}`;
        break;
      case "updated":
        suffix = ` → updated${recipeId ? ` (id ${recipeId})` : ""}`;
        break;
      case "would-import":
        suffix = " → would import";
        break;
      case "would-update":
        suffix = ` → would update${recipeId ? ` (id ${recipeId})` : ""}`;
        break;
      case "skipped":
        suffix = " → skipped (already imported)";
        break;
      case "failed":
        suffix = ` → failed (${error ?? "unknown error"})`;
        break;
    }
    console.log(`${label.padEnd(6)} ${titleStr}${suffix}`);
  };

  const shared = {
    limit,
    dryRun: parsed.values["dry-run"],
    overwrite: parsed.values.overwrite,
    debug: parsed.values.debug,
    onlyRecipeId: parsed.values["recipe-id"],
    onlyTitleSubstring: parsed.values.title,
    onRecipe,
  };

  let summary;
  if (parsed.values.api) {
    const baseUrl = parsed.values.api.trim();
    if (!/^https?:\/\//i.test(baseUrl)) {
      console.error("[familywall] --api must be a full URL, e.g. https://nomly.example.tld");
      process.exit(2);
    }
    let token = (parsed.values.token ?? "").trim();
    if (!token) {
      // Not passed via --token: ask for it (hidden input on a TTY).
      token = await promptToken();
    }
    if (!token) {
      console.error(
        "[familywall] --api needs a bearer token. Pass --token <token> or enter it when prompted.",
      );
      console.error("[familywall] Mint one with `npm run token:create -- --name import-cli`.");
      process.exit(2);
    }
    console.log(`[familywall] importing into ${baseUrl} over the API (local cache kept as backup)`);
    const { runFamilywallImportViaApi } = await import(
      "../src/lib/familywall/api-client.ts"
    );
    summary = await runFamilywallImportViaApi({ ...shared, baseUrl, token });
  } else {
    const { runFamilywallImport } = await import("../src/lib/familywall/index.ts");
    summary = await runFamilywallImport(shared);
  }

  console.log("---");
  console.log(
    `done: ${summary.imported} imported, ${summary.updated} updated, ${summary.skipped} skipped, ${summary.failed} failed`,
  );
  if (parsed.values["dry-run"]) {
    const where = parsed.values.api ? "the remote DB" : "the DB";
    console.log(`(dry run — nothing written to ${where})`);
  }
}

main().catch((err) => {
  console.error("[familywall] fatal:", err);
  process.exit(1);
});
