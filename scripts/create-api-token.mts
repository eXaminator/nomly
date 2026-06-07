import nextEnv from "@next/env";
import { parseArgs } from "node:util";

// Mint a machine API token (for the Familywall API importer or any other
// non-browser client). Run inside the prod container against the live DB:
//   docker compose exec nomly \
//     node --experimental-transform-types --disable-warning=ExperimentalWarning \
//     scripts/create-api-token.mts --name import-cli
//
// The raw token is printed ONCE — only its sha256 hash is stored.

const HELP = `Usage: npm run token:create -- --name <label> [--scope full|embed]

Required:
  --name <label>   Human label stored with the token (e.g. "import-cli")

Optional:
  --scope <scope>  "full" (default, whole API) or "embed" (only the Home
                   Assistant recipe-iframe allow-list)
  --help           Print this help`;

async function main() {
  nextEnv.loadEnvConfig(process.cwd(), false);

  const { values } = parseArgs({
    options: {
      name: { type: "string" },
      scope: { type: "string", default: "full" },
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

  const scope = values.scope;
  if (scope !== "full" && scope !== "embed") {
    console.error(`[token] --scope must be "full" or "embed" (got "${scope}").`);
    console.error(HELP);
    process.exit(2);
  }

  const { createApiToken } = await import("../src/lib/bearer.ts");
  const minted = createApiToken(name, scope);

  console.log(`[token] created "${minted.name}" (id ${minted.id}, scope ${minted.scope}).`);
  console.log("[token] Store this now — it is not recoverable:");
  console.log("");
  console.log(`  ${minted.token}`);
  console.log("");
  if (minted.scope === "embed") {
    console.log("[token] Embed token — pass as ?k=<token> on /embed/** URLs.");
  } else {
    console.log("[token] Use it as: Authorization: Bearer <token>");
  }
}

main().catch((err) => {
  console.error("[token] fatal:", err);
  process.exit(1);
});
