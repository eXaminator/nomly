import type { NextConfig } from "next";

/**
 * Hostnames the dev server must accept requests for dev-only resources (HMR,
 * stack frames) from. Next.js only trusts the host it was started on; behind a
 * proxy — e.g. a Paseo service URL like `dev--<branch>--<project>.<domain>`
 * — the browser's origin is the proxy host, i.e. BASE_URL. Only consulted by
 * `next dev`; production ignores it.
 */
function devOriginHosts(): string[] {
  const hosts = new Set<string>();
  for (const url of [process.env.BASE_URL, process.env.PASEO_URL]) {
    if (!url) continue;
    try {
      hosts.add(new URL(url).hostname);
    } catch {
      // Not a URL — nothing to allow.
    }
  }
  return [...hosts];
}

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "node-ical"],
  allowedDevOrigins: devOriginHosts(),
  experimental: {
    // Router fetches (navigation, prefetch, RSC refresh, Server Actions) that
    // fail no longer fall through to an MPA navigation: Next parks them and
    // retries once connectivity returns. That MPA fallback is a hard
    // `location` assign, which — with the service worker serving the shell
    // from cache — is exactly what turned a failing server into an endless
    // reload. See src/components/auth/request-guard.tsx.
    useOffline: true,
  },
};

export default nextConfig;
