import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type BuildManifest = {
  pages?: Record<string, string[]>;
  rootMainFiles?: string[];
};

async function loadBuildManifest(): Promise<BuildManifest | null> {
  for (const candidate of [".next/app-build-manifest.json", ".next/build-manifest.json"]) {
    try {
      const raw = await readFile(candidate, "utf8");
      return JSON.parse(raw) as BuildManifest;
    } catch {
      continue;
    }
  }
  return null;
}

// Build-manifest page keys look like "/(app)/einkauf/page" in the app
// router. Strip route groups and the trailing "/page" so they're comparable
// to route paths ("/(app)/page" → "/").
function normalizePageKey(page: string): string {
  const cleaned = page.replace(/\/\([^)]*\)/g, "").replace(/\/page$/, "");
  return cleaned === "" ? "/" : cleaned;
}

// Routes whose page chunks the SW precaches: everything that must render
// offline. ("/_app"/"/_layout" cover the pages-router style manifest.)
const PRECACHE_ROUTES = new Set(["/", "/start", "/einkauf", "/offline", "/_app", "/_layout"]);

async function main(): Promise<void> {
  const manifest = await loadBuildManifest();
  const assets = new Set<string>();

  if (manifest?.pages) {
    for (const [page, files] of Object.entries(manifest.pages)) {
      if (PRECACHE_ROUTES.has(normalizePageKey(page))) {
        for (const f of files) assets.add(`/_next/${f}`);
      }
    }
  }
  if (manifest?.rootMainFiles) {
    for (const f of manifest.rootMainFiles) assets.add(`/_next/${f}`);
  }

  // App shell extras the SW always wants cached on install. `/offline` is the
  // generic fallback served when a navigation fails offline; `/start` is the
  // PWA entry redirect and must work at offline launch. The dashboard `/` is
  // deliberately NOT in this list — the SW seeds it itself with
  // `redirect: "error"` so a logged-out install can't cache the login page.
  const shell = [
    "/einkauf",
    "/start",
    "/offline",
    "/manifest.webmanifest",
    "/icons/icon.svg",
    "/icons/icon-192.png",
  ];

  const payload = { shell, assets: Array.from(assets).sort() };
  await writeFile(join("public", "sw-precache.json"), JSON.stringify(payload, null, 2));
  console.log(`> wrote public/sw-precache.json (${shell.length} shell + ${assets.size} assets)`);
}

main().catch((err) => {
  console.error("precache generator failed", err);
  process.exit(1);
});
