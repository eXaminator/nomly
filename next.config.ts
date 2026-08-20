import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "node-ical"],
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
