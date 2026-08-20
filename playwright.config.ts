import { defineConfig, devices } from "@playwright/test";

import { E2E_BASE_URL, E2E_CONFIG } from "./tests/e2e/support/config.ts";

/**
 * End-to-end harness. Runs against a production build, because the behaviour
 * under test — service worker, router offline handling, request guard — is
 * either disabled or differently timed in dev.
 *
 * The browser reaches the app through a fault-injecting proxy rather than
 * directly, so a spec can make the server "go down" the way it does in
 * production: the proxy answers instead of the container. See
 * support/fault-proxy.mjs.
 *
 * `npm run test:e2e` builds first. Unit tests (`npm test`) stay browser-free.
 *
 * Set `E2E_CHROMIUM_PATH` to run against a Chromium that is already on the box
 * instead of the build Playwright wants to download — sandboxes and CI images
 * that ship their own browser need it, and the pinned download would not match.
 */
const appEnv = {
  NODE_ENV: "production",
  BASE_URL: E2E_BASE_URL,
  SESSION_SECRET: E2E_CONFIG.sessionSecret,
  DATABASE_URL: E2E_CONFIG.databaseUrl,
  PORT: String(E2E_CONFIG.appPort),
  HOSTNAME: "127.0.0.1",
  // Never contacted: the harness mints its own session cookie and the minted
  // session carries no refresh token, so nothing tries to reach an IdP.
  OIDC_ISSUER: "https://auth.invalid/application/o/nomly/",
  OIDC_CLIENT_ID: "nomly-e2e",
  OIDC_CLIENT_SECRET: "nomly-e2e-secret",
};

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/support/global-setup.ts",
  // The specs toggle one shared proxy and measure reload counts over real time,
  // so they must not run against each other.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? "line" : "list",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: E2E_BASE_URL,
    storageState: E2E_CONFIG.storageStatePath,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: process.env.E2E_CHROMIUM_PATH
          ? { executablePath: process.env.E2E_CHROMIUM_PATH }
          : {},
      },
    },
  ],
  webServer: [
    {
      command: `node --experimental-transform-types --disable-warning=ExperimentalWarning server.mts`,
      url: `http://127.0.0.1:${E2E_CONFIG.appPort}/api/health`,
      env: appEnv,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120_000,
    },
    {
      command: "node tests/e2e/support/fault-proxy.mjs",
      url: `${E2E_BASE_URL}/__mode`,
      env: {
        E2E_APP_PORT: String(E2E_CONFIG.appPort),
        E2E_PROXY_PORT: String(E2E_CONFIG.proxyPort),
      },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
