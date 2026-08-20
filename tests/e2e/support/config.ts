import { resolve } from "node:path";

/**
 * One place for the values the Playwright config, the global setup and the
 * specs all have to agree on. Ports, secret and DB path are fixed rather than
 * random so a failed run leaves something you can poke at by hand.
 */
export const E2E_CONFIG = {
  /** The app itself. Nothing in the tests talks to it directly. */
  appPort: 3000,
  /** The fault proxy the browser talks to — see support/fault-proxy.mjs. */
  proxyPort: 3100,
  /** Disposable; global setup deletes and rebuilds it on every run. */
  databaseUrl: "./data/e2e.db",
  /** Must be ≥32 chars (src/lib/env.ts) and match the minted cookie's seal. */
  sessionSecret: "nomly-e2e-session-secret-at-least-32-chars",
  storageStatePath: resolve("tests/e2e/.auth/storage-state.json"),
} as const;

export const E2E_BASE_URL = `http://127.0.0.1:${E2E_CONFIG.proxyPort}`;
