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

async function main(): Promise<void> {
  const manifest = await loadBuildManifest();
  const assets = new Set<string>();

  if (manifest?.pages) {
    for (const [page, files] of Object.entries(manifest.pages)) {
      if (
        page === "/einkauf" ||
        page === "/offline" ||
        page === "/_app" ||
        page === "/_layout"
      ) {
        for (const f of files) assets.add(`/_next/${f}`);
      }
    }
  }
  if (manifest?.rootMainFiles) {
    for (const f of manifest.rootMainFiles) assets.add(`/_next/${f}`);
  }

  // App shell extras the SW always wants cached on install. `/offline` is the
  // generic fallback served when any non-`/einkauf` navigation fails offline —
  // it keeps the app header + nav reachable on every page.
  const shell = [
    "/einkauf",
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
