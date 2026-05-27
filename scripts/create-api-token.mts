import nextEnv from "@next/env";
import { parseArgs } from "node:util";

// Mint a machine API token (for the Familywall API importer or any other
// non-browser client). Run inside the prod container against the live DB:
//   docker compose exec nomly \
//     node --experimental-transform-types --disable-warning=ExperimentalWarning \
//     scripts/create-api-token.mts --name import-cli
//
// The raw token is printed ONCE — only its sha256 hash is stored.

const HELP = `Usage: npm run token:create -- --name <label>

Required:
  --name <label>   Human label stored with the token (e.g. "import-cli")
  --help           Print this help`;

async function main() {
  nextEnv.loadEnvConfig(process.cwd(), false);

  const { values } = parseArgs({
    options: {
      name: { type: "string" },
      help: { type: "boolean", default: false },
    },
    allowPositionals: false,
    strict: true,
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  const name = values.name?.trim() ?? "";
  if (!name) {
    console.error("[token] --name is required.");
    console.error(HELP);
    process.exit(2);
  }

  const { createApiToken } = await import("../src/lib/bearer.ts");
  const minted = createApiToken(name);

  console.log(`[token] created "${minted.name}" (id ${minted.id}).`);
  console.log("[token] Store this now — it is not recoverable:");
  console.log("");
  console.log(`  ${minted.token}`);
  console.log("");
  console.log("[token] Use it as: Authorization: Bearer <token>");
}

main().catch((err) => {
  console.error("[token] fatal:", err);
  process.exit(1);
});
